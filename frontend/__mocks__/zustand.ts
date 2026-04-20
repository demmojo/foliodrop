import { vi } from 'vitest'
import type * as ZustandExportedTypes from 'zustand'

const actualZustand = await vi.importActual<typeof ZustandExportedTypes>('zustand')

export const storeResetFns = new Set<() => void>()

export const create = (<T>(stateCreator: ZustandExportedTypes.StateCreator<T>) => {
  const store = actualZustand.create(stateCreator)
  const initialState = store.getState()
  storeResetFns.add(() => {
    store.setState(initialState, true)
  })
  return store
}) as typeof ZustandExportedTypes.create
