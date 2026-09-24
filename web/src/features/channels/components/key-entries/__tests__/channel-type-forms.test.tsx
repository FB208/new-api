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
import { render, screen } from '@testing-library/react'
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

function EditorHarness(props: { initial: KeyEntry[]; format: KeyEntryFormat }) {
  const [entries, setEntries] = useState(props.initial)
  return (
    <I18nextProvider i18n={i18n}>
      <KeyEntriesEditor
        entries={entries}
        onChange={setEntries}
        format={props.format}
      />
    </I18nextProvider>
  )
}

test('a plain channel edits the key as a single field', () => {
  render(<EditorHarness format='plain' initial={[createKeyEntry('sk-abc')]} />)

  expect(screen.getByRole('textbox', { name: 'Key 1' })).toHaveValue('sk-abc')
  expect(
    screen.queryByRole('textbox', { name: 'Access Key' })
  ).not.toBeInTheDocument()
})

test('an AWS channel splits the packed key into its three credentials', () => {
  render(
    <EditorHarness
      format='aws_ak_sk'
      initial={[createKeyEntry('AKIA123|secret456|us-east-1')]}
    />
  )

  expect(screen.getByRole('textbox', { name: 'Access Key' })).toHaveValue(
    'AKIA123'
  )
  expect(
    screen.getByRole('textbox', { name: 'Secret Access Key' })
  ).toHaveValue('secret456')
  expect(screen.getByRole('textbox', { name: 'Region' })).toHaveValue(
    'us-east-1'
  )
})

test('editing one AWS credential repacks the whole key', async () => {
  const user = userEvent.setup()
  render(
    <EditorHarness
      format='aws_ak_sk'
      initial={[createKeyEntry('AKIA123|secret456|us-east-1')]}
    />
  )

  const region = screen.getByRole('textbox', { name: 'Region' })
  await user.clear(region)
  await user.type(region, 'eu-west-1')

  // The other two segments must survive the repack untouched.
  expect(screen.getByRole('textbox', { name: 'Access Key' })).toHaveValue(
    'AKIA123'
  )
  expect(
    screen.getByRole('textbox', { name: 'Secret Access Key' })
  ).toHaveValue('secret456')
  expect(region).toHaveValue('eu-west-1')
})

test('an AWS api_key channel shows only the key and its region', () => {
  render(
    <EditorHarness
      format='aws_api_key'
      initial={[createKeyEntry('APIKEY789|eu-west-1')]}
    />
  )

  expect(screen.getByRole('textbox', { name: 'API Key' })).toHaveValue(
    'APIKEY789'
  )
  expect(screen.getByRole('textbox', { name: 'Region' })).toHaveValue(
    'eu-west-1'
  )
  expect(
    screen.queryByRole('textbox', { name: 'Secret Access Key' })
  ).not.toBeInTheDocument()
})

test('an incomplete AWS key is reported on its row', () => {
  render(
    <EditorHarness format='aws_ak_sk' initial={[createKeyEntry('AKIA123')]} />
  )

  expect(screen.getByRole('alert')).toHaveTextContent(
    'AWS key must be in the format AccessKey|SecretAccessKey|Region'
  )
})

test('a Vertex channel edits each service account as multi-line JSON', () => {
  render(
    <EditorHarness
      format='vertex_json'
      initial={[createKeyEntry('{"client_email":"a@x.com"}')]}
    />
  )

  const field = screen.getByRole('textbox', { name: 'Key 1' })
  expect(field.tagName).toBe('TEXTAREA')
  expect(field).toHaveValue('{"client_email":"a@x.com"}')
})

test('a Vertex key that is not valid JSON is reported on its row', () => {
  render(
    <EditorHarness
      format='vertex_json'
      initial={[createKeyEntry('not-json')]}
    />
  )

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Vertex AI service account key must be valid JSON'
  )
})

// Service account files are pretty-printed JSON. Splitting a pasted one on
// newlines would produce one broken row per line instead of one credential.
test('bulk pasting a pretty printed Vertex credential imports it as one key', async () => {
  const user = userEvent.setup()
  render(<EditorHarness format='vertex_json' initial={[]} />)

  await user.click(screen.getByRole('tab', { name: 'Bulk paste' }))
  await user.click(screen.getByRole('textbox', { name: 'Bulk paste' }))
  await user.paste(
    '{\n  "type": "service_account",\n  "client_email": "a@x.com"\n}'
  )
  await user.click(screen.getByRole('button', { name: 'Add to list' }))
  await user.click(screen.getByRole('tab', { name: 'One key per row' }))

  expect(screen.getByRole('textbox', { name: 'Key 1' })).toHaveValue(
    '{"type":"service_account","client_email":"a@x.com"}'
  )
  expect(
    screen.queryByRole('textbox', { name: 'Key 2' })
  ).not.toBeInTheDocument()
})
