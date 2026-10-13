package service

import (
	"errors"
	"fmt"
	"net/http"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

func GetChannelConstraints(c *gin.Context) *dto.ChannelConstraints {
	if c == nil {
		return &dto.ChannelConstraints{}
	}
	if existing, ok := common.GetContextKeyType[*dto.ChannelConstraints](c, constant.ContextKeyChannelConstraints); ok && existing != nil {
		return existing
	}
	constraints := &dto.ChannelConstraints{}
	common.SetContextKey(c, constant.ContextKeyChannelConstraints, constraints)
	return constraints
}

func AppendTaskPluginIdentityFilter(c *gin.Context, pluginKey string) {
	if c == nil {
		return
	}
	channelTypes, pluginKeys := pinnedTaskPluginIdentities(c, pluginKey)
	GetChannelConstraints(c).AddFilter(dto.ChannelFilter{
		Kind:                   dto.FilterTaskPluginIdentity,
		TaskPluginKey:          pluginKey,
		TaskPluginChannelTypes: channelTypes,
		TaskPluginKeys:         pluginKeys,
	})
}

type RetryParam struct {
	Ctx             *gin.Context
	TokenGroup      string
	ModelName       string
	RequestPath     string
	Retry           *int
	resetNextTry    bool
	triedChannelIds []int
}

// MarkChannelTried records a channel this request already sent an attempt to.
// Later selections skip it, so a request never retries the same channel.
func (p *RetryParam) MarkChannelTried(channelId int) {
	if !slices.Contains(p.triedChannelIds, channelId) {
		p.triedChannelIds = append(p.triedChannelIds, channelId)
	}
}

func (p *RetryParam) GetRetry() int {
	if p.Retry == nil {
		return 0
	}
	return *p.Retry
}

func (p *RetryParam) SetRetry(retry int) {
	p.Retry = &retry
}

func (p *RetryParam) IncreaseRetry() {
	if p.resetNextTry {
		p.resetNextTry = false
		return
	}
	if p.Retry == nil {
		p.Retry = new(int)
	}
	*p.Retry++
}

func (p *RetryParam) ResetRetryNextTry() {
	p.resetNextTry = true
}

// CacheGetRandomSatisfiedChannel selects the channel for the next attempt.
// 选择下一次尝试使用的渠道。
//
// Channels marked with MarkChannelTried are never selected again, so retries
// walk the untried channels from the highest priority down (weighted random
// within a priority). A nil channel means every candidate has been tried.
// 已尝试过的渠道不会再被选中：重试按优先级从高到低逐个使用未尝试的渠道
// （同优先级内按权重随机），返回 nil 表示所有候选渠道都已尝试过。
//
// For the "auto" token group the groups are walked in order:
// 对于 "auto" 分组，按顺序遍历分组：
//
//   - ContextKeyAutoGroupIndex holds the group the next attempt starts from.
//     ContextKeyAutoGroupIndex 记录下一次尝试从哪个分组开始。
//
//   - Without cross-group retry, retries stay in the group of the first attempt
//     and stop once that group has no untried channel.
//     未开启跨分组重试时，重试只在首次尝试所在的分组内进行，该分组渠道试完即停止。
//
//   - With cross-group retry, a group is left when it has no untried channel or
//     after RetryTimes retries in it, and the retry counter restarts at 0 for the
//     next group, so the retry budget is counted per group.
//     开启跨分组重试时，分组内渠道试完或重试次数用完后切换到下一个分组，
//     并将重试计数归零，即重试次数按分组计算。
func CacheGetRandomSatisfiedChannel(param *RetryParam) (*model.Channel, string, error) {
	filters := GetChannelConstraints(param.Ctx).Filters
	if param.TokenGroup != "auto" {
		channel, err := model.GetRandomSatisfiedChannel(param.TokenGroup, param.ModelName, param.triedChannelIds, filters)
		if err != nil {
			return nil, param.TokenGroup, err
		}
		return channel, param.TokenGroup, nil
	}

	userGroup := common.GetContextKeyString(param.Ctx, constant.ContextKeyUserGroup)
	autoGroups := GetRequestAutoGroups(param.Ctx, userGroup)
	if len(autoGroups) == 0 {
		return nil, param.TokenGroup, errors.New("auto groups is not enabled")
	}
	crossGroupRetry := common.GetContextKeyBool(param.Ctx, constant.ContextKeyTokenCrossGroupRetry)
	currentGroup := common.GetContextKeyString(param.Ctx, constant.ContextKeyAutoGroup)
	if len(param.triedChannelIds) > 0 && currentGroup != "" && !crossGroupRetry {
		channel, err := model.GetRandomSatisfiedChannel(currentGroup, param.ModelName, param.triedChannelIds, filters)
		return channel, currentGroup, err
	}

	startGroupIndex, _ := common.GetContextKeyType[int](param.Ctx, constant.ContextKeyAutoGroupIndex)
	for i := startGroupIndex; i < len(autoGroups); i++ {
		autoGroup := autoGroups[i]
		// groupRetry counts the retries already spent in this group.
		// groupRetry 表示当前分组内已经使用的重试次数。
		groupRetry := param.GetRetry()
		if i > startGroupIndex {
			groupRetry = 0
		}
		logger.LogDebug(param.Ctx, "Auto selecting group: %s, groupRetry: %d", autoGroup, groupRetry)

		channel, _ := model.GetRandomSatisfiedChannel(autoGroup, param.ModelName, param.triedChannelIds, filters)
		if channel == nil {
			// No untried channel for this model in this group: move on to the next
			// group with a fresh retry count.
			// 当前分组没有未尝试的可用渠道：切换到下一个分组并重置重试计数。
			logger.LogDebug(param.Ctx, "No untried channel in group %s for model %s, trying next group", autoGroup, param.ModelName)
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i+1)
			param.SetRetry(0)
			continue
		}
		common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroup, autoGroup)
		logger.LogDebug(param.Ctx, "Auto selected group: %s", autoGroup)

		if crossGroupRetry && groupRetry >= common.RetryTimes {
			// This attempt still uses the current group; the next retry starts from
			// the next group with a fresh retry count.
			// 本次仍使用当前分组，下次重试从下一个分组开始并重置重试计数。
			logger.LogDebug(param.Ctx, "Current group %s retries exhausted (groupRetry=%d >= RetryTimes=%d), preparing switch to next group for next retry", autoGroup, groupRetry, common.RetryTimes)
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i+1)
			param.SetRetry(0)
			param.ResetRetryNextTry()
		} else {
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i)
		}
		return channel, autoGroup, nil
	}
	return nil, param.TokenGroup, nil
}

// HasUntriedChannel reports whether CacheGetRandomSatisfiedChannel can still
// select a channel this request has not tried, without changing the auto-group
// routing state. Relay loops check it before retrying so the request stops
// with the last upstream error once every candidate channel has failed.
func HasUntriedChannel(param *RetryParam) bool {
	groups := []string{param.TokenGroup}
	if param.TokenGroup == "auto" {
		crossGroupRetry := common.GetContextKeyBool(param.Ctx, constant.ContextKeyTokenCrossGroupRetry)
		currentGroup := common.GetContextKeyString(param.Ctx, constant.ContextKeyAutoGroup)
		if len(param.triedChannelIds) > 0 && currentGroup != "" && !crossGroupRetry {
			groups = []string{currentGroup}
		} else {
			autoGroups := GetRequestAutoGroups(param.Ctx, common.GetContextKeyString(param.Ctx, constant.ContextKeyUserGroup))
			startGroupIndex, _ := common.GetContextKeyType[int](param.Ctx, constant.ContextKeyAutoGroupIndex)
			groups = autoGroups[min(startGroupIndex, len(autoGroups)):]
		}
	}
	filters := GetChannelConstraints(param.Ctx).Filters
	for _, group := range groups {
		channel, err := model.GetRandomSatisfiedChannel(group, param.ModelName, param.triedChannelIds, filters)
		// A lookup error is left for the real selection to report.
		if err != nil || channel != nil {
			return true
		}
	}
	return false
}

func pinnedTaskPluginIdentities(c *gin.Context, expected string) ([]int, []string) {
	if c == nil || expected == "" {
		return nil, nil
	}
	if value, exists := c.Get(jsplugin.ContextKeyPinnedEndpoint); exists {
		pinned, ok := value.(jsplugin.PinnedEndpoint)
		if ok && pinned.Generation != nil && len(pinned.Candidates) > 1 {
			expectedFound := false
			channelTypes := make([]int, 0, len(pinned.Candidates))
			pluginKeys := make([]string, 0, len(pinned.Candidates))
			seen := make(map[int]struct{}, len(pinned.Candidates))
			for _, candidate := range pinned.Candidates {
				if candidate.Plugin == nil {
					continue
				}
				if candidate.Plugin.Meta.Key == expected {
					expectedFound = true
				}
				pluginKeys = append(pluginKeys, candidate.Plugin.Meta.Key)
				for _, channelType := range candidate.Plugin.Meta.ChannelTypes {
					if channelType == 0 || channelType == constant.ChannelTypeTaskPlugin {
						continue
					}
					if _, duplicate := seen[channelType]; duplicate {
						continue
					}
					if plugin, indexed := pinned.Generation.GetByChannelType(channelType); indexed && plugin == candidate.Plugin {
						seen[channelType] = struct{}{}
						channelTypes = append(channelTypes, channelType)
					}
				}
			}
			if expectedFound {
				return channelTypes, pluginKeys
			}
		}
	}
	value, exists := c.Get(jsplugin.ContextKeyPinnedPlugin)
	pinned, ok := value.(jsplugin.PinnedPlugin)
	if !exists || !ok || pinned.Generation == nil || pinned.Plugin == nil || pinned.Plugin.Meta.Key != expected {
		return nil, nil
	}
	channelTypes := make([]int, 0, len(pinned.Plugin.Meta.ChannelTypes))
	for _, channelType := range pinned.Plugin.Meta.ChannelTypes {
		if channelType == 0 || channelType == constant.ChannelTypeTaskPlugin {
			continue
		}
		channelTypes = append(channelTypes, channelType)
	}
	return channelTypes, []string{expected}
}

// ChannelSelectError explains why SelectChannelForRequest found no channel.
// Callers render it for their transport: the HTTP distributor localizes
// MessageID with its own helpers and the Responses WebSocket relay wraps it in
// a NewAPIError. Message is set instead of MessageID when the text is a fixed
// error code that clients match on.
type ChannelSelectError struct {
	StatusCode int
	Code       types.ErrorCode
	MessageID  string
	Params     map[string]any
	Message    string
	// FilterKind and Channel identify a candidate rejected by request filters.
	FilterKind dto.ChannelFilterKind
	Channel    *model.Channel
	// NoAvailableChannel marks the "no channel for this group and model"
	// outcome so the distributor can name the claiming task plugin.
	NoAvailableChannel bool
}

// SelectChannelForRequest resolves the channel for one attempt with the rules
// shared by the HTTP distributor and the Responses WebSocket relay: a pinned
// channel wins, then session affinity (first attempt only), then a random
// eligible channel; every candidate must satisfy the request's channel
// filters. The group the channel was chosen from is returned for auto-group
// callers. The caller still applies SetupContextForSelectedChannel.
func SelectChannelForRequest(c *gin.Context, modelName string, retry *RetryParam) (*model.Channel, string, *ChannelSelectError) {
	constraints := GetChannelConstraints(c)
	if pin, found, overridden := constraints.ResolvedPin(); found {
		for _, lost := range overridden {
			logger.LogWarn(c, fmt.Sprintf(
				"channel pin overridden: winning_source=%s winning_channel_id=%d overridden_source=%s overridden_channel_id=%d",
				pin.Source, pin.ChannelId, lost.Source, lost.ChannelId,
			))
		}
		channel, err := model.CacheGetChannel(pin.ChannelId)
		if err != nil {
			return nil, "", pinnedChannelUnavailable(pin, http.StatusBadRequest, i18n.MsgDistributorInvalidChannelId)
		}
		if channel.Status != common.ChannelStatusEnabled {
			return nil, "", pinnedChannelUnavailable(pin, http.StatusForbidden, i18n.MsgDistributorChannelDisabled)
		}
		if ok, kind := model.ChannelSatisfiesFilters(channel, modelName, constraints.Filters); !ok {
			return nil, "", &ChannelSelectError{
				StatusCode: http.StatusBadRequest, Code: types.ErrorCode(kind), MessageID: i18n.MsgDistributorNoAvailableChannel,
				Params:     map[string]any{"Group": common.GetContextKeyString(c, constant.ContextKeyUsingGroup), "Model": modelName},
				FilterKind: kind, Channel: channel,
			}
		}
		return channel, "", nil
	}

	usingGroup := retry.TokenGroup
	var channel *model.Channel
	var selectGroup string
	// Session affinity only steers the first attempt; the counter also restarts
	// at 0 on a cross-group switch, when the preferred channel may already be tried.
	if retry.GetRetry() == 0 && len(retry.triedChannelIds) == 0 {
		if preferredChannelID, found := GetPreferredChannelByAffinity(c, modelName, usingGroup); found {
			affinityUsable := false
			preferred, err := model.CacheGetChannel(preferredChannelID)
			affinitySatisfied := false
			if err == nil && preferred != nil && preferred.Status == common.ChannelStatusEnabled {
				affinitySatisfied, _ = model.ChannelSatisfiesFilters(preferred, modelName, constraints.Filters)
			}
			if affinitySatisfied {
				if usingGroup == "auto" {
					userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
					for _, g := range GetRequestAutoGroups(c, userGroup) {
						if model.IsChannelEnabledForGroupModel(g, modelName, preferred.Id) {
							selectGroup = g
							common.SetContextKey(c, constant.ContextKeyAutoGroup, g)
							channel = preferred
							affinityUsable = true
							MarkChannelAffinityUsed(c, g, preferred.Id)
							break
						}
					}
				} else if model.IsChannelEnabledForGroupModel(usingGroup, modelName, preferred.Id) {
					channel = preferred
					selectGroup = usingGroup
					affinityUsable = true
					MarkChannelAffinityUsed(c, usingGroup, preferred.Id)
				}
			}
			if !affinityUsable && !ShouldKeepChannelAffinityOnChannelDisabled() {
				ClearCurrentChannelAffinityCache(c)
			}
			if !affinityUsable && RequestPolicy(c).SessionMode == "strict" {
				return nil, "", &ChannelSelectError{StatusCode: http.StatusServiceUnavailable, Message: "strict_session_binding_unavailable"}
			}
		}
	}

	if channel == nil {
		var err error
		channel, selectGroup, err = CacheGetRandomSatisfiedChannel(retry)
		if err != nil {
			showGroup := usingGroup
			if usingGroup == "auto" {
				showGroup = fmt.Sprintf("auto(%s)", selectGroup)
			}
			return nil, selectGroup, &ChannelSelectError{
				StatusCode: http.StatusServiceUnavailable, Code: types.ErrorCodeModelNotFound, MessageID: i18n.MsgDistributorGetChannelFailed,
				Params: map[string]any{"Group": showGroup, "Model": modelName, "Error": err.Error()},
			}
		}
		if channel == nil {
			return nil, selectGroup, &ChannelSelectError{
				StatusCode: http.StatusServiceUnavailable, Code: types.ErrorCodeModelNotFound, MessageID: i18n.MsgDistributorNoAvailableChannel,
				Params: map[string]any{"Group": usingGroup, "Model": modelName}, NoAvailableChannel: true,
			}
		}
	}
	if ok, kind := model.ChannelSatisfiesFilters(channel, modelName, constraints.Filters); !ok {
		return nil, selectGroup, &ChannelSelectError{
			StatusCode: http.StatusServiceUnavailable, Code: types.ErrorCodeModelNotFound, MessageID: i18n.MsgDistributorNoAvailableChannel,
			Params:     map[string]any{"Group": common.GetContextKeyString(c, constant.ContextKeyUsingGroup), "Model": modelName},
			FilterKind: kind, Channel: channel, NoAvailableChannel: true,
		}
	}
	return channel, selectGroup, nil
}

// Origin-task pins report a fixed code so task polling can tell a retired
// channel from a malformed request.
func pinnedChannelUnavailable(pin dto.ChannelPin, statusCode int, messageID string) *ChannelSelectError {
	if pin.Source == dto.PinSourceOriginTask {
		return &ChannelSelectError{StatusCode: http.StatusBadRequest, Code: "origin_task_channel_disabled", Message: "origin_task_channel_disabled"}
	}
	return &ChannelSelectError{StatusCode: statusCode, MessageID: messageID}
}

// AppendUsedChannel records an attempted channel in the request's channel
// trail, which the retry log and the consume log's admin_info both read.
func AppendUsedChannel(c *gin.Context, channelID int) {
	c.Set("use_channel", append(c.GetStringSlice("use_channel"), fmt.Sprintf("%d", channelID)))
}
