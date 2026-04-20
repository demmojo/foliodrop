import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { act } from '@testing-library/react'

// Mock Zustand
import { storeResetFns } from './__mocks__/zustand'

beforeEach(() => {
  act(() => {
    storeResetFns.forEach((resetFn) => resetFn())
  })
})
