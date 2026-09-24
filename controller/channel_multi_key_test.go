package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMultiKeyEnableRestoresOnlyExhaustedChannels(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousMaster, previousCache, previousRedis, previousSQLite := common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousType, previousLogType)
		common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath = previousMaster, previousCache, previousRedis, previousSQLite
	})
	t.Setenv("SQL_DSN", os.Getenv("TEST_CHANNEL_SQL_DSN"))
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "channel.db")
	require.NoError(t, model.InitDB())
	database := model.DB
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	model.LOG_DB = database
	common.SetLogDatabaseType(common.MainDatabaseType())
	require.NoError(t, database.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.User{}, &model.Log{}, &model.AuditLog{}))
	root := &model.User{Username: "multi-key-review-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	require.NoError(t, database.Create(root).Error)
	t.Cleanup(func() { require.NoError(t, database.Unscoped().Delete(root).Error) })
	versionQuery := "SELECT VERSION()"
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		versionQuery = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, database.Raw(versionQuery).Scan(&version).Error)
	t.Logf("database=%s version=%s", common.MainDatabaseType(), version)

	for _, cacheEnabled := range []bool{false, true} {
		for _, action := range []string{"enable_key", "enable_all_keys"} {
			for _, tc := range []struct {
				name           string
				initialStatus  int
				manualOverride string
				wantStatus     int
			}{
				{name: "key exhaustion restores", initialStatus: common.ChannelStatusEnabled, wantStatus: common.ChannelStatusEnabled},
				{name: "manual disable is preserved", initialStatus: common.ChannelStatusManuallyDisabled, wantStatus: common.ChannelStatusManuallyDisabled},
				{name: "manual disable after exhaustion is preserved", initialStatus: common.ChannelStatusEnabled, manualOverride: "status", wantStatus: common.ChannelStatusManuallyDisabled},
				{name: "tag disable after exhaustion is preserved", initialStatus: common.ChannelStatusEnabled, manualOverride: "tag", wantStatus: common.ChannelStatusManuallyDisabled},
			} {
				t.Run(fmt.Sprintf("cache=%t/%s/%s", cacheEnabled, action, tc.name), func(t *testing.T) {
					common.MemoryCacheEnabled = cacheEnabled
					tag := t.Name()
					channel := &model.Channel{Name: t.Name(), Type: 1, Key: "key-one\nkey-two", Status: tc.initialStatus, Models: "test-model", Group: "default", Tag: &tag,
						ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyStatusList: map[int]int{1: common.ChannelStatusManuallyDisabled}},
					}
					require.NoError(t, channel.Insert())
					t.Cleanup(func() {
						require.NoError(t, channel.Delete())
						model.InitChannelCache()
					})
					for _, operation := range []string{"disable_key", action} {
						if operation == action {
							if tc.manualOverride == "status" {
								model.UpdateChannelStatus(channel.Id, "", common.ChannelStatusManuallyDisabled, "manual operation")
							} else if tc.manualOverride == "tag" {
								require.NoError(t, model.DisableChannelByTag(tag))
							}
						}
						payload, err := common.Marshal(MultiKeyManageRequest{ChannelId: channel.Id, Action: operation, KeyIndex: common.GetPointer(0)})
						require.NoError(t, err)
						recorder := httptest.NewRecorder()
						c, _ := gin.CreateTestContext(recorder)
						c.Set("id", root.Id)
						c.Set("role", common.RoleRootUser)
						c.Request = httptest.NewRequest(http.MethodPost, "/api/channel/multi_key", bytes.NewReader(payload))
						c.Request.Header.Set("Content-Type", "application/json")
						ManageMultiKeys(c)
						var result struct {
							Success bool `json:"success"`
						}
						require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
						require.True(t, result.Success, recorder.Body.String())
					}
					loaded, err := model.GetChannelById(channel.Id, true)
					require.NoError(t, err)
					assert.Equal(t, tc.wantStatus, loaded.Status)
					assert.NotContains(t, loaded.ChannelInfo.MultiKeyStatusList, 0)
					assert.NotContains(t, loaded.ChannelInfo.MultiKeyDisabledReason, 0)
					assert.NotContains(t, loaded.ChannelInfo.MultiKeyDisabledTime, 0)
					var ability model.Ability
					require.NoError(t, database.Where("channel_id = ?", channel.Id).First(&ability).Error)
					assert.Equal(t, tc.wantStatus == common.ChannelStatusEnabled, ability.Enabled)
				})
			}
		}
	}
}

// multiKeyTestEnv wires a real database for the multi-key editing tests.
// TEST_CHANNEL_SQL_DSN selects the engine, as in the test above.
type multiKeyTestEnv struct {
	root *model.User
	db   *gorm.DB
}

func newMultiKeyTestEnv(t *testing.T) *multiKeyTestEnv {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousMaster, previousCache, previousRedis, previousSQLite := common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousType, previousLogType)
		common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath = previousMaster, previousCache, previousRedis, previousSQLite
	})
	t.Setenv("SQL_DSN", os.Getenv("TEST_CHANNEL_SQL_DSN"))
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "channel.db")
	require.NoError(t, model.InitDB())
	sqlDB, err := model.DB.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	model.LOG_DB = model.DB
	common.SetLogDatabaseType(common.MainDatabaseType())
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.User{}, &model.Log{}, &model.AuditLog{}))
	root := &model.User{Username: "multi-key-editor-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(root).Error)
	t.Cleanup(func() { require.NoError(t, model.DB.Unscoped().Delete(root).Error) })
	return &multiKeyTestEnv{root: root, db: model.DB}
}

func (env *multiKeyTestEnv) manage(t *testing.T, role int, request MultiKeyManageRequest) (bool, string) {
	t.Helper()
	payload, err := common.Marshal(request)
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", env.root.Id)
	c.Set("role", role)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/channel/multi_key/manage", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	ManageMultiKeys(c)
	var result struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
	return result.Success, result.Message
}

func (env *multiKeyTestEnv) insertChannel(t *testing.T, channelType int, key string, info model.ChannelInfo) *model.Channel {
	t.Helper()
	info.IsMultiKey = true
	info.MultiKeySize = len(strings.Split(key, "\n"))
	channel := &model.Channel{
		Name: t.Name(), Type: channelType, Key: key, Status: common.ChannelStatusEnabled,
		Models: "test-model", Group: "default", ChannelInfo: info,
	}
	require.NoError(t, channel.Insert())
	t.Cleanup(func() {
		require.NoError(t, channel.Delete())
		model.InitChannelCache()
	})
	return channel
}

func (env *multiKeyTestEnv) load(t *testing.T, id int) *model.Channel {
	t.Helper()
	channel, err := model.GetChannelById(id, true)
	require.NoError(t, err)
	return channel
}

// A remark belongs to one key; deleting an earlier key moves the later keys up,
// so their remarks must move with them.
func TestMultiKeyDeletionCarriesRemarksToSurvivingKeys(t *testing.T) {
	env := newMultiKeyTestEnv(t)

	for _, tc := range []struct {
		name       string
		request    MultiKeyManageRequest
		statusList map[int]int
	}{
		{name: "delete_key", request: MultiKeyManageRequest{Action: "delete_key", KeyIndex: common.GetPointer(1)}},
		{
			name:       "delete_disabled_keys",
			request:    MultiKeyManageRequest{Action: "delete_disabled_keys"},
			statusList: map[int]int{1: common.ChannelStatusAutoDisabled},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			channel := env.insertChannel(t, 1, "key-zero\nkey-one\nkey-two", model.ChannelInfo{
				MultiKeyRemark:     map[int]string{0: "first", 1: "middle", 2: "last"},
				MultiKeyStatusList: tc.statusList,
			})
			request := tc.request
			request.ChannelId = channel.Id

			success, message := env.manage(t, common.RoleRootUser, request)
			require.True(t, success, message)

			loaded := env.load(t, channel.Id)
			assert.Equal(t, "key-zero\nkey-two", loaded.Key)
			assert.Equal(t, map[int]string{0: "first", 1: "last"}, loaded.ChannelInfo.MultiKeyRemark)
		})
	}
}

func TestMultiKeyUpdateKey(t *testing.T) {
	env := newMultiKeyTestEnv(t)

	t.Run("replacing a key clears the old key's disabled state", func(t *testing.T) {
		channel := env.insertChannel(t, 1, "key-zero\nkey-one", model.ChannelInfo{
			MultiKeyStatusList:     map[int]int{1: common.ChannelStatusAutoDisabled},
			MultiKeyDisabledReason: map[int]string{1: "upstream rejected the key"},
		})
		success, message := env.manage(t, common.RoleRootUser, MultiKeyManageRequest{
			ChannelId: channel.Id, Action: "update_key",
			KeyIndex: common.GetPointer(1), Key: common.GetPointer("key-one-rotated"),
		})
		require.True(t, success, message)

		loaded := env.load(t, channel.Id)
		assert.Equal(t, "key-zero\nkey-one-rotated", loaded.Key)
		assert.NotContains(t, loaded.ChannelInfo.MultiKeyStatusList, 1)
		assert.NotContains(t, loaded.ChannelInfo.MultiKeyDisabledReason, 1)
	})

	t.Run("a remark is set and cleared without touching the key", func(t *testing.T) {
		channel := env.insertChannel(t, 1, "key-zero\nkey-one", model.ChannelInfo{})
		success, message := env.manage(t, common.RoleRootUser, MultiKeyManageRequest{
			ChannelId: channel.Id, Action: "update_key",
			KeyIndex: common.GetPointer(1), Remark: common.GetPointer("  billing  "),
		})
		require.True(t, success, message)
		loaded := env.load(t, channel.Id)
		assert.Equal(t, map[int]string{1: "billing"}, loaded.ChannelInfo.MultiKeyRemark)
		assert.Equal(t, "key-zero\nkey-one", loaded.Key)

		success, message = env.manage(t, common.RoleRootUser, MultiKeyManageRequest{
			ChannelId: channel.Id, Action: "update_key",
			KeyIndex: common.GetPointer(1), Remark: common.GetPointer(""),
		})
		require.True(t, success, message)
		assert.Empty(t, env.load(t, channel.Id).ChannelInfo.MultiKeyRemark)
	})

	t.Run("a blank replacement key is rejected", func(t *testing.T) {
		channel := env.insertChannel(t, 1, "key-zero", model.ChannelInfo{})
		success, _ := env.manage(t, common.RoleRootUser, MultiKeyManageRequest{
			ChannelId: channel.Id, Action: "update_key",
			KeyIndex: common.GetPointer(0), Key: common.GetPointer("   "),
		})
		require.False(t, success)
		assert.Equal(t, "key-zero", env.load(t, channel.Id).Key)
	})

	t.Run("an over long remark is rejected", func(t *testing.T) {
		channel := env.insertChannel(t, 1, "key-zero", model.ChannelInfo{})
		success, _ := env.manage(t, common.RoleRootUser, MultiKeyManageRequest{
			ChannelId: channel.Id, Action: "update_key", KeyIndex: common.GetPointer(0),
			Remark: common.GetPointer(strings.Repeat("x", multiKeyRemarkMaxLength+1)),
		})
		require.False(t, success)
		assert.Empty(t, env.load(t, channel.Id).ChannelInfo.MultiKeyRemark)
	})
}

func TestMultiKeyAddKeys(t *testing.T) {
	env := newMultiKeyTestEnv(t)

	t.Run("keys are appended with their remarks and blank inputs skipped", func(t *testing.T) {
		channel := env.insertChannel(t, 1, "key-zero", model.ChannelInfo{MultiKeyRemark: map[int]string{0: "original"}})
		success, message := env.manage(t, common.RoleRootUser, MultiKeyManageRequest{
			ChannelId: channel.Id, Action: "add_keys",
			Keys: []MultiKeyAddInput{{Key: "  key-one  ", Remark: "second"}, {Key: "   "}, {Key: "key-two"}},
		})
		require.True(t, success, message)

		loaded := env.load(t, channel.Id)
		assert.Equal(t, "key-zero\nkey-one\nkey-two", loaded.Key)
		assert.Equal(t, 3, loaded.ChannelInfo.MultiKeySize)
		assert.Equal(t, map[int]string{0: "original", 1: "second"}, loaded.ChannelInfo.MultiKeyRemark)
	})

	t.Run("a batch with no usable key is rejected", func(t *testing.T) {
		channel := env.insertChannel(t, 1, "key-zero", model.ChannelInfo{})
		success, _ := env.manage(t, common.RoleRootUser, MultiKeyManageRequest{
			ChannelId: channel.Id, Action: "add_keys", Keys: []MultiKeyAddInput{{Key: "  "}},
		})
		require.False(t, success)
		assert.Equal(t, "key-zero", env.load(t, channel.Id).Key)
	})
}

// The editor is root-only in the UI; the server has to enforce the same rule.
func TestMultiKeyWriteActionsRequireRootRole(t *testing.T) {
	env := newMultiKeyTestEnv(t)

	for _, request := range []MultiKeyManageRequest{
		{Action: "update_key", KeyIndex: common.GetPointer(0), Key: common.GetPointer("key-rotated")},
		{Action: "add_keys", Keys: []MultiKeyAddInput{{Key: "key-one"}}},
	} {
		t.Run(request.Action, func(t *testing.T) {
			channel := env.insertChannel(t, 1, "key-zero", model.ChannelInfo{})
			request.ChannelId = channel.Id

			success, _ := env.manage(t, common.RoleAdminUser, request)
			require.False(t, success)
			assert.Equal(t, "key-zero", env.load(t, channel.Id).Key)
		})
	}
}

// Keys are stored newline separated, so a written key must occupy one line:
// otherwise it is read back as several keys and every later index shifts.
func TestMultiKeyWritesStoreEachKeyOnOneLine(t *testing.T) {
	env := newMultiKeyTestEnv(t)
	const storedCredential = `{"client_email":"old@x.com"}`
	const prettyCredential = "{\n  \"client_email\": \"new@x.com\"\n}"

	for _, tc := range []struct {
		name        string
		channelType int
		request     MultiKeyManageRequest
		wantSuccess bool
		wantKey     string
	}{
		{
			name:        "a pretty printed Vertex credential is compacted on update",
			channelType: constant.ChannelTypeVertexAi,
			request:     MultiKeyManageRequest{Action: "update_key", KeyIndex: common.GetPointer(0), Key: common.GetPointer(prettyCredential)},
			wantSuccess: true,
			wantKey:     `{"client_email":"new@x.com"}`,
		},
		{
			name:        "a pretty printed Vertex credential is compacted on add",
			channelType: constant.ChannelTypeVertexAi,
			request:     MultiKeyManageRequest{Action: "add_keys", Keys: []MultiKeyAddInput{{Key: prettyCredential}}},
			wantSuccess: true,
			wantKey:     storedCredential + "\n" + `{"client_email":"new@x.com"}`,
		},
		{
			name:        "a plain key containing a newline is rejected",
			channelType: 1,
			request:     MultiKeyManageRequest{Action: "add_keys", Keys: []MultiKeyAddInput{{Key: "sk-one\nsk-two"}}},
			wantSuccess: false,
			wantKey:     storedCredential,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			channel := env.insertChannel(t, tc.channelType, storedCredential, model.ChannelInfo{})
			request := tc.request
			request.ChannelId = channel.Id

			success, message := env.manage(t, common.RoleRootUser, request)
			require.Equal(t, tc.wantSuccess, success, message)
			assert.Equal(t, tc.wantKey, env.load(t, channel.Id).Key)
		})
	}
}

func TestAddMultiKeyChannelStoresKeyRemarks(t *testing.T) {
	env := newMultiKeyTestEnv(t)
	body, err := common.Marshal(map[string]any{
		"mode":           "multi_to_single",
		"multi_key_mode": "random",
		"key_remarks":    map[string]string{"1": "backup", "9": "out of range"},
		"channel": map[string]any{
			"type": 1, "name": t.Name(), "key": "sk-first\nsk-second",
			"models": "test-model", "group": "default",
		},
	})
	require.NoError(t, err)

	recorder := postAddChannel(t, env.root.Id, common.RoleRootUser, string(body))
	require.Contains(t, recorder.Body.String(), `"success":true`, recorder.Body.String())

	var created model.Channel
	require.NoError(t, env.db.Where("name = ?", t.Name()).First(&created).Error)
	t.Cleanup(func() { require.NoError(t, created.Delete()) })
	assert.Equal(t, map[int]string{1: "backup"}, created.ChannelInfo.MultiKeyRemark)
}

// Replacing the list through the channel edit form must not leave the old keys'
// remarks on whichever new keys take their positions; appending keeps them.
func TestUpdateChannelKeyModeHandlesRemarks(t *testing.T) {
	env := newMultiKeyTestEnv(t)

	for _, tc := range []struct {
		keyMode     string
		wantRemarks map[int]string
	}{
		{keyMode: "replace", wantRemarks: nil},
		{keyMode: "append", wantRemarks: map[int]string{0: "a", 1: "b"}},
	} {
		t.Run(tc.keyMode, func(t *testing.T) {
			channel := env.insertChannel(t, 1, "key-a\nkey-b", model.ChannelInfo{MultiKeyRemark: map[int]string{0: "a", 1: "b"}})
			body, err := common.Marshal(map[string]any{
				"id": channel.Id, "type": 1, "name": channel.Name, "key": "key-new", "key_mode": tc.keyMode,
				"models": "test-model", "group": "default",
			})
			require.NoError(t, err)

			recorder := putUpdateChannel(t, env.root.Id, common.RoleRootUser, string(body))
			require.Contains(t, recorder.Body.String(), `"success":true`, recorder.Body.String())
			assert.Equal(t, tc.wantRemarks, env.load(t, channel.Id).ChannelInfo.MultiKeyRemark)
		})
	}
}

// Saving edited rows replaces the whole list. A key's disabled state must follow
// that key to its new position, and the remarks come from the submitted rows.
func TestUpdateChannelReplaceKeepsEachKeysStateAndTakesSubmittedRemarks(t *testing.T) {
	env := newMultiKeyTestEnv(t)
	channel := env.insertChannel(t, 1, "key-a\nkey-b\nkey-c", model.ChannelInfo{
		MultiKeyStatusList: map[int]int{1: common.ChannelStatusAutoDisabled},
		MultiKeyRemark:     map[int]string{0: "a", 1: "b"},
	})
	body, err := common.Marshal(map[string]any{
		"id": channel.Id, "type": 1, "name": channel.Name, "models": "test-model", "group": "default",
		"key": "key-b\nkey-c", "key_mode": "replace", "key_remarks": map[string]string{"1": "third"},
	})
	require.NoError(t, err)

	recorder := putUpdateChannel(t, env.root.Id, common.RoleRootUser, string(body))
	require.Contains(t, recorder.Body.String(), `"success":true`, recorder.Body.String())

	loaded := env.load(t, channel.Id)
	assert.Equal(t, "key-b\nkey-c", loaded.Key)
	assert.Equal(t, map[int]int{0: common.ChannelStatusAutoDisabled}, loaded.ChannelInfo.MultiKeyStatusList)
	assert.Equal(t, map[int]string{1: "third"}, loaded.ChannelInfo.MultiKeyRemark)
}
