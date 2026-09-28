// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnboardingModal } from '@deepseek-ai/dsh-client-ui-primitives'

let appRoot: HTMLDivElement

beforeEach(() => {
  appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.appendChild(appRoot)
})

afterEach(() => {
  cleanup()
  appRoot.remove()
})

function dialog(): HTMLElement {
  return document.body.querySelector('[role="dialog"]')!
}

describe('OnboardingModal', () => {
  it('titles the blocking dialog and renders the step body', () => {
    render(<OnboardingModal title="Run models here"><p>step body</p></OnboardingModal>)
    expect(dialog().getAttribute('aria-label')).toBe('Run models here')
    expect(dialog().textContent).toContain('step body')
  })

  it('holds #root inert while mounted and restores the previous value', () => {
    appRoot.inert = true
    const view = render(<OnboardingModal title="t">body</OnboardingModal>)
    expect(appRoot.inert).toBe(true)
    view.unmount()
    expect(appRoot.inert).toBe(true)
  })

  it('stays mounted when the mask or Escape is used', () => {
    render(<OnboardingModal title="t">body</OnboardingModal>)
    document.querySelector<HTMLElement>('[class*="mask"]')!.click()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dialog()).not.toBeNull()
  })

  it('focuses the title only when the step has no form control', () => {
    const plain = render(<OnboardingModal title="plain" focusTitle>body</OnboardingModal>)
    const plainTitle = document.querySelector<HTMLHeadingElement>('h2')!
    expect(plainTitle.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(plainTitle)
    plain.unmount()

    render(<OnboardingModal title="with input"><input /></OnboardingModal>)
    expect(document.querySelector<HTMLHeadingElement>('h2')!.hasAttribute('tabindex')).toBe(false)
    expect(document.activeElement).toBe(document.body)
  })

  it('renders without an #root element (compositions that mount elsewhere)', () => {
    appRoot.remove()
    const view = render(<OnboardingModal title="t">body</OnboardingModal>)
    expect(dialog()).not.toBeNull()
    view.unmount()
  })
})
