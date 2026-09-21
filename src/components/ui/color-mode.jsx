'use client'

import { ClientOnly, IconButton, Skeleton, Span } from '@chakra-ui/react'

import * as React from 'react'
import { LuMoon, LuSun } from 'react-icons/lu'

/*
 * The portal is light only: it is designed against one palette and offers no way
 * to switch.
 *
 * This was next-themes' ThemeProvider, which injects a <script> so a
 * server-rendered page can set its theme before it paints. There is no server
 * here — Vite serves a client-rendered app — so that script was never executed,
 * and React warned about a <script> inside a component on every render. Holding
 * the mode as plain state costs nothing and keeps the console clean; the exports
 * below are unchanged, so adding a dark palette later is a matter of putting a
 * real value in this provider.
 */
const ColorModeContext = React.createContext({
  colorMode: 'light',
  setColorMode: () => {},
  toggleColorMode: () => {},
})

export function ColorModeProvider({ children, defaultTheme = 'light' }) {
  const [colorMode, setColorMode] = React.useState(defaultTheme === 'dark' ? 'dark' : 'light')

  const value = React.useMemo(
    () => ({
      colorMode,
      setColorMode,
      toggleColorMode: () => setColorMode((mode) => (mode === 'dark' ? 'light' : 'dark')),
    }),
    [colorMode],
  )

  // The class Chakra's theme reads, as next-themes used to set it.
  React.useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(colorMode)
    root.style.colorScheme = colorMode
  }, [colorMode])

  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>
}

export function useColorMode() {
  return React.useContext(ColorModeContext)
}

export function useColorModeValue(light, dark) {
  const { colorMode } = useColorMode()
  return colorMode === 'dark' ? dark : light
}

export function ColorModeIcon() {
  const { colorMode } = useColorMode()
  return colorMode === 'dark' ? <LuMoon /> : <LuSun />
}

export const ColorModeButton = React.forwardRef(
  function ColorModeButton(props, ref) {
    const { toggleColorMode } = useColorMode()
    return (
      <ClientOnly fallback={<Skeleton boxSize='9' />}>
        <IconButton
          onClick={toggleColorMode}
          variant='ghost'
          aria-label='Toggle color mode'
          size='sm'
          ref={ref}
          {...props}
          css={{
            _icon: {
              width: '5',
              height: '5',
            },
          }}
        >
          <ColorModeIcon />
        </IconButton>
      </ClientOnly>
    )
  },
)

export const LightMode = React.forwardRef(function LightMode(props, ref) {
  return (
    <Span
      color='fg'
      display='contents'
      className='chakra-theme light'
      colorPalette='gray'
      colorScheme='light'
      ref={ref}
      {...props}
    />
  )
})

export const DarkMode = React.forwardRef(function DarkMode(props, ref) {
  return (
    <Span
      color='fg'
      display='contents'
      className='chakra-theme dark'
      colorPalette='gray'
      colorScheme='dark'
      ref={ref}
      {...props}
    />
  )
})
