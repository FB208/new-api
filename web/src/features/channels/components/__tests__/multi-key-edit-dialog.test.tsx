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
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import type { KeyStatus } from '../../types'
import { MultiKeyEditDialog } from '../dialogs/multi-key-edit-dialog'

const listedKey: KeyStatus = {
  index: 2,
  status: 1,
  key_preview: 'sk-c...c3c3',
}

function renderDialog(onSaved = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <MultiKeyEditDialog
      open
      onOpenChange={onOpenChange}
      channelId={7}
      keyStatus={listedKey}
      format='plain'
      onSaved={onSaved}
    />
  )
  return { onSaved, onOpenChange }
}

// Leaving the key field empty keeps the stored key, so a remark-only edit must
// not send any key material.
test('saving a remark only edit updates that key without sending a key value', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  const { onSaved } = renderDialog()

  await user.type(
    screen.getByRole('textbox', { name: 'Remark (optional)' }),
    'billing'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/channel/multi_key/manage',
      expect.objectContaining({
        channel_id: 7,
        action: 'update_key',
        key_index: 2,
        remark: 'billing',
      }),
      expect.anything()
    )
  )
  expect(post.mock.calls[0][1]).not.toHaveProperty('key')
  expect(onSaved).toHaveBeenCalledTimes(1)
})

test('a rejected edit keeps the dialog open and does not report a save', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message: 'The key was changed or moved; refresh the key list',
    },
  })
  const user = userEvent.setup()
  const { onSaved, onOpenChange } = renderDialog()

  await user.type(
    screen.getByRole('textbox', { name: 'Remark (optional)' }),
    'billing'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(onSaved).not.toHaveBeenCalled()
  expect(onOpenChange).not.toHaveBeenCalledWith(false)
})
