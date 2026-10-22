import { createContext, useContext } from 'react'
import { CONTROL_STATE, controlMessage, controlState } from '@/lib/portalControls'

/** Filled by components/PortalControlsProvider.jsx: { controls, developer, user }. */
export const PortalControlsContext = createContext({ controls: {}, developer: false, user: null })

/** Every control (id -> row), and whether the signed-in user is a developer. */
export default function usePortalControls() {
  return useContext(PortalControlsContext)
}

/**
 * One control as the signed-in user meets it. A developer is never blocked
 * (`hidden` and `maintenance` stay false) but still gets `state`, so the UI
 * can mark what everyone else does not see.
 */
export function useControl(id) {
  return useControls()(id)
}

function checkControl(controls, developer, id) {
  const state = controlState(controls, id)
  const hidden = !developer && state === CONTROL_STATE.HIDDEN
  const maintenance = !developer && state === CONTROL_STATE.MAINTENANCE
  return {
    state,
    message: controlMessage(controls, id),
    developer,
    hidden,
    maintenance,
    // Whether the signed-in user may press it at all.
    usable: !hidden && !maintenance,
  }
}

/**
 * `useControl` for many ids at once — for a component with several buttons or
 * a menu: `const control = useControls(); control('button.clients.edit').hidden`.
 */
export function useControls() {
  const { controls, developer } = useContext(PortalControlsContext)
  return (id) => checkControl(controls, developer, id)
}
