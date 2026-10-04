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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import { handleUpdateChannelField } from '../lib/channel-actions'
import { createChannelFieldUpdateScheduler } from '../lib/channel-field-update'
import { NumericSpinnerInput } from './numeric-spinner-input'

// Reuse the channel table's field editor for model connections.
export function ChannelFieldCell(props: {
  channelId: number
  value: number | null | undefined
  field: 'priority' | 'weight'
  min: number
  disabled?: boolean
  onSuccess?: (value: number) => void
}) {
  const queryClient = useQueryClient()
  const onSuccess = props.onSuccess
  const scheduler = useMemo(
    () =>
      createChannelFieldUpdateScheduler((value) => {
        void handleUpdateChannelField(
          props.channelId,
          props.field,
          value,
          queryClient,
          () => onSuccess?.(value)
        )
      }),
    [props.channelId, props.field, onSuccess, queryClient]
  )

  useEffect(() => () => scheduler.flush(), [scheduler])

  return (
    <NumericSpinnerInput
      value={props.value ?? 0}
      onChange={scheduler.schedule}
      onCommit={scheduler.flush}
      min={props.min}
      disabled={props.disabled}
    />
  )
}
