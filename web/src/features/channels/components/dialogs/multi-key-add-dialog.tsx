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
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { addMultiKeys } from '../../api'
import {
  MULTI_KEY_ERROR_MESSAGES,
  MULTI_KEY_SUCCESS_MESSAGES,
} from '../../constants'
import {
  createKeyEntry,
  validateKeyEntry,
  type KeyEntry,
  type KeyEntryFormat,
} from '../../lib/key-entry-serialization'
import { KeyEntriesEditor } from '../key-entries'

type MultiKeyAddDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelId: number
  format: KeyEntryFormat
  onSaved: () => void
}

export function MultiKeyAddDialog(props: MultiKeyAddDialogProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<KeyEntry[]>([])
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setEntries([createKeyEntry()])
  }, [props.open])

  const filled = entries.filter((entry) => entry.value.trim() !== '')
  const hasInvalidEntry = filled.some(
    (entry) => validateKeyEntry(entry, props.format) !== null
  )
  const canSave = filled.length > 0 && !hasInvalidEntry && !isSaving

  const handleSave = async () => {
    if (!canSave) return
    setIsSaving(true)
    try {
      const response = await addMultiKeys(
        props.channelId,
        filled.map((entry) => ({
          key: entry.value.trim(),
          remark: entry.remark.trim(),
        }))
      )
      if (!response.success) {
        handleServerError(response, t(MULTI_KEY_ERROR_MESSAGES.ADD_KEYS_FAILED))
        return
      }
      toast.success(t(MULTI_KEY_SUCCESS_MESSAGES.KEYS_ADDED))
      props.onSaved()
      props.onOpenChange(false)
    } catch (error: unknown) {
      handleServerError(error, t(MULTI_KEY_ERROR_MESSAGES.ADD_KEYS_FAILED))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Add keys')}
      description={t('New keys are appended to the end of the key list.')}
      contentClassName='max-w-3xl'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={isSaving}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isSaving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('Save')}
          </Button>
        </>
      }
    >
      <KeyEntriesEditor
        entries={entries}
        onChange={setEntries}
        format={props.format}
        disabled={isSaving}
      />
    </Dialog>
  )
}
