/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import { api } from '@/lib/api'

import { KeyEntriesEditor } from '../../components/key-entries/key-entries-editor'
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  type ChannelFormValues,
} from '../../lib/channel-form'
import {
  createKeyEntry,
  type KeyEntry,
  type KeyEntryFormat,
} from '../../lib/key-entry-serialization'
import { useChannelKeyTest } from '../use-channel-key-test'

let i18n: I18nInstance
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
})
afterEach(() => vi.restoreAllMocks())

// Render the hook through the real key editor so assertions describe visible behavior.
function Harness(props: {
  entries: KeyEntry[]
  values?: Partial<ChannelFormValues>
  open?: boolean
  channelId?: number
  format?: KeyEntryFormat
}) {
  const testing = useChannelKeyTest({
    open: props.open ?? true,
    channelId: props.channelId ?? 1,
    enabled: true,
    entries: props.entries,
    format: props.format ?? 'plain',
    values: {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      type: 1,
      models: 'draft-model',
      ...props.values,
    },
  })
  return (
    <I18nextProvider i18n={i18n}>
      <KeyEntriesEditor
        entries={props.entries}
        format={props.format ?? 'plain'}
        onChange={() => {}}
        testing={{
          ...testing,
          onTest: (id) => {
            void testing.runTests(id)
          },
        }}
      />
    </I18nextProvider>
  )
}

// Supply explicit completion points without sleeps or timing assertions.
function deferredReply() {
  let resolve!: (value: ReturnType<typeof reply>) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<ReturnType<typeof reply>>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    }
  )
  return { promise, resolve, reject }
}

function reply(available = true, message = '') {
  return {
    data: {
      success: true,
      data: { available, message, time: 0.5, model: 'draft-model' },
    },
  }
}

test('testing a row sends its unsaved key and current connection settings and keeps the result when only remarks change', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(reply())
  const entries = [createKeyEntry('first'), createKeyEntry('unsaved-second')]
  const values = {
    base_url: 'https://draft.example/',
    test_model: 'chosen-model',
    model_mapping: '{"chosen-model":"upstream"}',
    header_override: '{"X-Draft":"yes"}',
    param_override: '{"max_tokens":12}',
    proxy: 'http://proxy.example:8080',
  }
  const view = render(<Harness entries={entries} values={values} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Test key 2' }))
  await screen.findByText('Success')
  expect(post).toHaveBeenCalledOnce()
  expect(post.mock.calls[0][0]).toBe('/api/channel/test/key')
  expect(post.mock.calls[0][1]).toMatchObject({
    channel: {
      key: 'unsaved-second',
      base_url: 'https://draft.example',
      test_model: 'chosen-model',
      model_mapping: values.model_mapping,
      header_override: values.header_override,
      param_override: values.param_override,
    },
  })
  expect(JSON.stringify(post.mock.calls[0][1])).not.toContain('first')
  expect(screen.getByText('Test time: 0.5 s')).toBeVisible()
  view.rerender(
    <Harness
      entries={entries.map((entry) => ({ ...entry, remark: 'new remark' }))}
      values={values}
    />
  )
  expect(screen.getByText('Success')).toBeVisible()
})

test('testing all rows limits outstanding calls to three and continues after failed and empty keys without deduplicating', async () => {
  const requests = Array.from({ length: 4 }, deferredReply)
  let next = 0
  const post = vi
    .spyOn(api, 'post')
    .mockImplementation(() => requests[next++].promise)
  const entries = ['one', 'duplicate', 'duplicate', 'last', ''].map((key) =>
    createKeyEntry(key)
  )
  render(<Harness entries={entries} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Test all keys' }))
  expect(post).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('button', { name: 'Test all keys' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Test key 1' })).toBeDisabled()
  await act(async () => {
    requests[1].resolve(reply(false, 'upstream rejected'))
    await requests[1].promise
  })
  await waitFor(() => expect(post).toHaveBeenCalledTimes(4))
  expect(screen.getByText('upstream rejected')).toBeVisible()
  await act(async () => {
    requests[0].resolve(reply())
    requests[2].resolve(reply())
    requests[3].resolve(reply())
    await Promise.all(requests.map((request) => request.promise))
  })
  expect(screen.getByText('Tested 5/5 · Success 3 · Failed 2')).toBeVisible()
  expect(screen.getByText('Key is required')).toBeVisible()
  expect(
    post.mock.calls.map(
      ([, data]) => (data as { channel: { key: string } }).channel.key
    )
  ).toEqual(['one', 'duplicate', 'duplicate', 'last'])
  expect(screen.getByRole('button', { name: 'Test all keys' })).toBeEnabled()
})

test.each(['close', 'channel', 'key', 'model', 'address', 'remove'] as const)(
  'changing %s discards late results and stops the remaining batch',
  async (change) => {
    const request = deferredReply()
    const post = vi.spyOn(api, 'post').mockReturnValue(request.promise)
    const entries = ['one', 'two', 'three', 'four'].map((key) =>
      createKeyEntry(key)
    )
    const view = render(<Harness entries={entries} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Test all keys' }))
    expect(post).toHaveBeenCalledTimes(3)
    let changedValues: Partial<ChannelFormValues> = {}
    if (change === 'model') {
      changedValues = { test_model: 'other-model' }
    } else if (change === 'address') {
      changedValues = { base_url: 'https://changed.example' }
    }
    view.rerender(
      <Harness
        entries={
          change === 'remove'
            ? entries.slice(1)
            : entries.map((entry, index) =>
                change === 'key' && index === 0
                  ? { ...entry, value: 'changed' }
                  : entry
              )
        }
        open={change !== 'close'}
        channelId={change === 'channel' ? 2 : 1}
        values={changedValues}
      />
    )
    expect(post.mock.calls[0][2]?.signal?.aborted).toBe(true)
    await act(async () => {
      request.resolve(reply(false, 'stale failure'))
      await request.promise
    })
    expect(post).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('stale failure')).not.toBeInTheDocument()
    expect(screen.queryByText('Success')).not.toBeInTheDocument()
    expect(screen.queryByText(/Tested \d/)).not.toBeInTheDocument()
  }
)

test('removing a completed row does not move its result to the next row and changing one key clears only that result', async () => {
  vi.spyOn(api, 'post').mockImplementation((_url, body) =>
    Promise.resolve(
      reply(
        false,
        `error-${(body as { channel: { key: string } }).channel.key}`
      )
    )
  )
  const entries = [createKeyEntry('one'), createKeyEntry('two')]
  const view = render(<Harness entries={entries} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Test all keys' }))
  await screen.findByText('error-two')
  view.rerender(
    <Harness entries={[{ ...entries[0], value: 'changed' }, entries[1]]} />
  )
  await waitFor(() =>
    expect(screen.queryByText('error-one')).not.toBeInTheDocument()
  )
  expect(screen.getByText('error-two')).toBeVisible()
  view.rerender(<Harness entries={[entries[1]]} />)
  expect(screen.getByText('error-two')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Key 1' })).toHaveValue('two')
})

test('a transport error is shown on its row and missing models prevent requests', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new Error('connection refused'))
  const entries = [createKeyEntry('one')]
  const view = render(<Harness entries={entries} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Test key 1' }))
  await screen.findByText('connection refused')
  view.rerender(
    <Harness entries={entries} values={{ models: '', test_model: '' }} />
  )
  expect(
    screen.getByText('Configure a test model or add a model first')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Test key 1' })).toBeDisabled()
  expect(post).toHaveBeenCalledOnce()
})
