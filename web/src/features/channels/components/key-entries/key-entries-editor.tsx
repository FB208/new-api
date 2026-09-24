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
import { ClipboardPaste, List, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

import {
  createKeyEntry,
  parseKeyFieldValues,
  validateKeyEntry,
  type KeyEntry,
  type KeyEntryFormat,
} from '../../lib/key-entry-serialization'
import { KeyEntryRow } from './key-entry-row'

type KeyEntriesEditorProps = {
  entries: KeyEntry[]
  onChange: (entries: KeyEntry[]) => void
  format: KeyEntryFormat
  disabled?: boolean
}

export function KeyEntriesEditor(props: KeyEntriesEditorProps) {
  const { t } = useTranslation()
  const fieldPrefix = useId()
  const [bulkText, setBulkText] = useState('')
  const pendingFocusRef = useRef<string | null>(null)

  const inputIdFor = (entryId: string) => `${fieldPrefix}-${entryId}`

  useEffect(() => {
    const entryId = pendingFocusRef.current
    if (!entryId) return
    pendingFocusRef.current = null
    // Attribute selector, not getElementById: useId values contain characters
    // that are not valid in a plain CSS id selector.
    const field = document.querySelector(`[id="${inputIdFor(entryId)}"]`)
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement
    ) {
      field.focus()
    }
    // inputIdFor is derived from a stable useId, so only the list drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.entries])

  const handleAddRow = () => {
    const entry = createKeyEntry()
    pendingFocusRef.current = entry.id
    props.onChange([...props.entries, entry])
  }

  const handleRemoveRow = (entryId: string) => {
    props.onChange(props.entries.filter((entry) => entry.id !== entryId))
  }

  const handleRowChange = (
    entryId: string,
    patch: Partial<Pick<KeyEntry, 'value' | 'remark'>>
  ) => {
    props.onChange(
      props.entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry
      )
    )
  }

  // Bulk paste appends rather than replacing: overwriting the list would
  // silently discard remarks the admin already typed. The text is read with the
  // channel's key format so a pasted, pretty-printed Vertex service account
  // becomes one key instead of one broken key per line.
  const handleBulkImport = () => {
    const imported = parseKeyFieldValues(bulkText, props.format)
    if (imported.length === 0) return
    props.onChange([
      ...props.entries,
      ...imported.map((value) => createKeyEntry(value)),
    ])
    setBulkText('')
  }

  // A row being typed into is not an error yet; a missing key is reported when
  // the form is submitted, not while the admin is still filling it in.
  const errorFor = (entry: KeyEntry): string | null => {
    const error = validateKeyEntry(entry, props.format)
    return error === 'Key is required' ? null : error
  }

  return (
    <Tabs defaultValue='rows' className='w-full'>
      <TabsList>
        <TabsTrigger value='rows'>
          <List className='mr-2 h-4 w-4' aria-hidden='true' />
          {t('One key per row')}
        </TabsTrigger>
        <TabsTrigger value='bulk'>
          <ClipboardPaste className='mr-2 h-4 w-4' aria-hidden='true' />
          {t('Bulk paste')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value='rows' className='flex flex-col gap-2'>
        {props.entries.length === 0 ? (
          <div className='text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm'>
            {t('No keys yet. Add one to get started.')}
          </div>
        ) : (
          props.entries.map((entry, index) => (
            <KeyEntryRow
              key={entry.id}
              entry={entry}
              index={index}
              format={props.format}
              error={errorFor(entry)}
              disabled={props.disabled}
              inputId={inputIdFor(entry.id)}
              onValueChange={(value) => handleRowChange(entry.id, { value })}
              onRemarkChange={(remark) => handleRowChange(entry.id, { remark })}
              onRemove={() => handleRemoveRow(entry.id)}
            />
          ))
        )}
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={handleAddRow}
          disabled={props.disabled}
          className='w-full'
        >
          <Plus className='mr-2 h-4 w-4' aria-hidden='true' />
          {t('Add key')}
        </Button>
      </TabsContent>

      <TabsContent value='bulk' className='flex flex-col gap-2'>
        <p className='text-muted-foreground text-sm'>
          {t('Paste one key per row. Imported keys are appended to the list.')}
        </p>
        <Textarea
          value={bulkText}
          onChange={(event) => setBulkText(event.target.value)}
          disabled={props.disabled}
          rows={8}
          placeholder={t('One key per line')}
          aria-label={t('Bulk paste')}
          className='font-mono'
        />
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={handleBulkImport}
          disabled={props.disabled || bulkText.trim() === ''}
          className='w-fit'
        >
          <Plus className='mr-2 h-4 w-4' aria-hidden='true' />
          {t('Add to list')}
        </Button>
      </TabsContent>
    </Tabs>
  )
}
