import { useState } from 'react'
import { Box, Flex, Icon, Image, Input, Spinner, Text } from '@chakra-ui/react'
import { LuEye, LuEyeOff, LuLock, LuMail } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import { COLORS } from '@/theme/colors'
import logo from '@/assets/BHRI OFFICIAL LOGO TRANSPARENT.png'

function Field({ id, label, icon, children }) {
  return (
    <Box>
      <Text
        as="label"
        htmlFor={id}
        display="block"
        mb="6px"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="600"
        fontSize="13px"
        color={COLORS.heading}
      >
        {label}
      </Text>
      <Flex align="center" position="relative">
        <Icon as={icon} boxSize="15px" color={COLORS.subtle} position="absolute" left="13px" zIndex={1} pointerEvents="none" />
        {children}
      </Flex>
    </Box>
  )
}

const inputProps = {
  h: '44px',
  pl: '38px',
  bg: COLORS.hoverBg,
  border: '1px solid transparent',
  borderRadius: '8px',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '14px',
  color: COLORS.heading,
  _placeholder: { color: COLORS.subtle },
  _focusVisible: { borderColor: COLORS.activeBg, bg: COLORS.surface, outline: 'none' },
}

/** Email + password sign-in against Supabase Auth. */
export default function SignInPage({ onSignIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onSignIn(email.trim(), password)
      // On success the auth listener swaps this page for the portal.
    } catch (err) {
      setError(err.message || 'Could not sign in.')
      setSubmitting(false)
    }
  }

  return (
    <Flex minH="100dvh" align="center" justify="center" bg={COLORS.canvas} px="16px" py="32px">
      <Card as="form" onSubmit={handleSubmit} w="full" maxW="400px" p={{ base: '24px', sm: '32px' }} noValidate>
        <Flex direction="column" align="center" gap="8px" mb="28px">
          {/* Wide and short with `cover`: the artwork is a band across a square transparent canvas. */}
          <Image src={logo} alt="BHRI" w="128px" h="54px" objectFit="cover" />
          <Text
            as="h1"
            mt="8px"
            fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
            fontWeight="700"
            fontSize="22px"
            letterSpacing="-0.4px"
            color={COLORS.heading}
          >
            Sign in to the Sales Portal
          </Text>
          <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle} textAlign="center">
            Use the email and password for your BHRI account.
          </Text>
        </Flex>

        <Flex direction="column" gap="16px">
          <Field id="signin-email" label="Email" icon={LuMail}>
            <Input
              id="signin-email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              {...inputProps}
            />
          </Field>

          <Field id="signin-password" label="Password" icon={LuLock}>
            <Input
              id="signin-password"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              {...inputProps}
              pr="44px"
            />
            <Flex
              as="button"
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              position="absolute"
              right="6px"
              align="center"
              justify="center"
              boxSize="32px"
              borderRadius="6px"
              color={COLORS.subtle}
              cursor="pointer"
              zIndex={1}
              _hover={{ bg: COLORS.border }}
              _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
            >
              <Icon as={showPassword ? LuEyeOff : LuEye} boxSize="16px" />
            </Flex>
          </Field>

          {error ? (
            <Text role="alert" fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color="#B91C1C">
              {error}
            </Text>
          ) : null}

          <Flex
            as="button"
            type="submit"
            disabled={submitting || !email.trim() || !password}
            align="center"
            justify="center"
            gap="8px"
            h="44px"
            mt="4px"
            borderRadius="8px"
            bg={COLORS.brandGreen}
            color="#FFFFFF"
            cursor="pointer"
            transition="opacity 120ms ease"
            _hover={{ opacity: 0.92 }}
            _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
            _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
          >
            {submitting ? <Spinner size="sm" /> : null}
            <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="14px">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Text>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  )
}
