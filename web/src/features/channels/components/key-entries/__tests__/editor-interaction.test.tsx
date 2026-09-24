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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'

import {
  createKeyEntry,
  type KeyEntry,
  type KeyEntryFormat,
} from '../../../lib/key-entry-serialization'
import { KeyEntriesEditor } from '../key-entries-editor'

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

function EditorHarness(props: {
  initial: KeyEntry[]
  format?: KeyEntryFormat
}) {
  const [entries, setEntries] = useState(props.initial)
  return (
    <I18nextProvider i18n={i18n}>
      <KeyEntriesEditor
        entries={entries}
        onChange={setEntries}
        format={props.format ?? 'plain'}
      />
    </I18nextProvider>
  )
}

test('an empty list explains how to get started instead of rendering a blank area', () => {
  render(<EditorHarness initial={[]} />)

  expect(screen.getByText('No keys yet. Add one to get started.')).toBeVisible()
})

test('clicking add key appends a row and focuses its input', async () => {
  const user = userEvent.setup()
  render(<EditorHarness initial={[createKeyEntry('sk-existing')]} />)

  await user.click(screen.getByRole('button', { name: 'Add key' }))

  const secondKey = screen.getByRole('textbox', { name: 'Key 2' })
  expect(secondKey).toBeVisible()
  await waitFor(() => expect(secondKey).toHaveFocus())
})

test('deleting a row removes only that key and renumbers the rest', async () => {
  const user = userEvent.setup()
  render(
    <EditorHarness
      initial={[
        createKeyEntry('sk-first'),
        createKeyEntry('sk-second'),
        createKeyEntry('sk-third'),
      ]}
    />
  )

  await user.click(screen.getByRole('button', { name: 'Delete key 2' }))

  expect(screen.queryByDisplayValue('sk-second')).not.toBeInTheDocument()
  expect(screen.getByDisplayValue('sk-first')).toBeVisible()
  // The third key keeps its value but moves up into position two.
  expect(screen.getByRole('textbox', { name: 'Key 2' })).toHaveValue('sk-third')
})

test('typing in a row updates only that key', async () => {
  const user = userEvent.setup()
  render(
    <EditorHarness
      initial={[createKeyEntry('sk-first'), createKeyEntry('sk-second')]}
    />
  )

  await user.type(screen.getByRole('textbox', { name: 'Key 1' }), '-edited')

  expect(screen.getByRole('textbox', { name: 'Key 1' })).toHaveValue(
    'sk-first-edited'
  )
  expect(screen.getByRole('textbox', { name: 'Key 2' })).toHaveValue(
    'sk-second'
  )
})

test('a remark is captured per key', async () => {
  const user = userEvent.setup()
  render(<EditorHarness initial={[createKeyEntry('sk-first')]} />)

  await user.type(
    screen.getByRole('textbox', { name: 'Remark for key 1' }),
    'billing account'
  )

  expect(screen.getByRole('textbox', { name: 'Remark for key 1' })).toHaveValue(
    'billing account'
  )
})

test('bulk paste appends the pasted keys without discarding existing rows', async () => {
  const user = userEvent.setup()
  render(<EditorHarness initial={[createKeyEntry('sk-existing', 'keep me')]} />)

  await user.click(screen.getByRole('tab', { name: 'Bulk paste' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Bulk paste' }),
    'sk-new-one\nsk-new-two'
  )
  await user.click(screen.getByRole('button', { name: 'Add to list' }))
  await user.click(screen.getByRole('tab', { name: 'One key per row' }))

  expect(screen.getByRole('textbox', { name: 'Key 1' })).toHaveValue(
    'sk-existing'
  )
  expect(screen.getByRole('textbox', { name: 'Remark for key 1' })).toHaveValue(
    'keep me'
  )
  expect(screen.getByRole('textbox', { name: 'Key 2' })).toHaveValue(
    'sk-new-one'
  )
  expect(screen.getByRole('textbox', { name: 'Key 3' })).toHaveValue(
    'sk-new-two'
  )
})

test('bulk paste ignores blank lines so they never become empty keys', async () => {
  const user = userEvent.setup()
  render(<EditorHarness initial={[]} />)

  await user.click(screen.getByRole('tab', { name: 'Bulk paste' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Bulk paste' }),
    'sk-one\n\n   \nsk-two'
  )
  await user.click(screen.getByRole('button', { name: 'Add to list' }))
  await user.click(screen.getByRole('tab', { name: 'One key per row' }))

  expect(screen.getByRole('textbox', { name: 'Key 1' })).toHaveValue('sk-one')
  expect(screen.getByRole('textbox', { name: 'Key 2' })).toHaveValue('sk-two')
  expect(
    screen.queryByRole('textbox', { name: 'Key 3' })
  ).not.toBeInTheDocument()
})

test('the import button stays disabled until something is pasted', async () => {
  const user = userEvent.setup()
  render(<EditorHarness initial={[]} />)

  await user.click(screen.getByRole('tab', { name: 'Bulk paste' }))

  expect(screen.getByRole('button', { name: 'Add to list' })).toBeDisabled()
})

test('a row being filled in is not reported as an error yet', async () => {
  const user = userEvent.setup()
  render(<EditorHarness initial={[]} />)

  await user.click(screen.getByRole('button', { name: 'Add key' }))

  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('an over long remark is reported on the row it belongs to', () => {
  render(
    <EditorHarness initial={[createKeyEntry('sk-first', 'x'.repeat(129))]} />
  )

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Remark must not exceed 128 characters'
  )
})
