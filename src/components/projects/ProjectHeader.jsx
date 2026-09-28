import { Box, Flex, Icon, Menu, NativeSelect, Portal, Text } from '@chakra-ui/react'
import {
  LuChevronDown,
  LuFolderKanban,
  LuMap,
  LuMountain,
  LuTable2,
} from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import { COLORS } from '@/theme/colors'

const VIEWS = [
  { value: 'table', label: 'Lot Table', icon: LuTable2 },
  { value: 'map', label: 'Map', icon: LuMap },
]

const ACTION_CATEGORIES = ['Content & media', 'Pricing', 'Lots & data']

/**
 * Project identity, view switch, and the project-level action menu. Every value
 * shown comes from `project`; missing fields render as an em dash, never a guess.
 */
export default function ProjectHeader({
  project,
  projects = [],
  onProjectChange,
  view,
  onViewChange,
  actions = [],
  onAction,
}) {
  const hasProject = Boolean(project.name)
  return (
    <Card p={{ base: '16px', md: '24px' }} minW={0}>
      <Flex align="center" justify="space-between" gap="20px" flexWrap="wrap">
        <Flex align="center" gap="16px" minW={0} flex="1" flexBasis={{ base: '100%', xl: 'auto' }}>
          <Flex
            align="center"
            justify="center"
            boxSize="56px"
            borderRadius="12px"
            bg="#E8F3EC"
            flexShrink={0}
          >
            <Icon as={LuMountain} boxSize="26px" color={COLORS.brandGreen} />
          </Flex>

          <Box minW={0}>
            <Text
              as="h2"
              fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
              fontWeight="700"
              fontSize="22px"
              lineHeight="28px"
              letterSpacing="-0.4px"
              color={hasProject ? COLORS.heading : COLORS.subtle}
            >
              {hasProject ? project.name : 'No project loaded'}
            </Text>


          </Box>
        </Flex>

        <Flex align="center" gap="10px" flexWrap="wrap" minW={0} w={{ base: 'full', xl: 'auto' }}>
          {projects.length ? (
            <NativeSelect.Root size="sm" w={{ base: 'full', sm: 'auto' }} minW={{ base: 0, sm: '170px' }}>
              <NativeSelect.Field
                name="project"
                aria-label="Project"
                value={project.code}
                onChange={(event) => onProjectChange?.(event.target.value)}
                h="36px"
                pl="12px"
                bg={COLORS.hoverBg}
                border="1px solid transparent"
                borderRadius="8px"
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="600"
                fontSize="13px"
                color={COLORS.heading}
                cursor="pointer"
                _focusVisible={{ borderColor: COLORS.activeBg, outline: 'none' }}
              >
                {projects.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name === option.code ? option.code : `${option.code} — ${option.name}`}
                    {option.hasLots ? '' : ' (no lots yet)'}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator color={COLORS.subtle} />
            </NativeSelect.Root>
          ) : null}

          <Menu.Root onSelect={(details) => onAction?.(details.value)}>
            <Menu.Trigger
              display="flex"
              alignItems="center"
              gap="8px"
              h="36px"
              px="14px"
              borderRadius="8px"
              bg={COLORS.statusBg}
              color={COLORS.activeBg}
              cursor="pointer"
              transition="background-color 120ms ease"
              _hover={{ bg: '#D9E5FF' }}
              _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
            >
              <Icon as={LuFolderKanban} boxSize="15px" />
              <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="13px">
                Project Actions
              </Text>
              <Icon as={LuChevronDown} boxSize="14px" />
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="240px" p="6px">
                  {ACTION_CATEGORIES.map((category, index) => {
                    const categoryActions = actions.filter((action) => action.category === category)
                    if (!categoryActions.length) return null
                    return (
                      <Menu.ItemGroup key={category} mt={index ? '6px' : undefined}>
                        <Menu.ItemGroupLabel
                          px="8px"
                          py="5px"
                          fontFamily="Inter, system-ui, sans-serif"
                          fontSize="10px"
                          fontWeight="700"
                          letterSpacing="0.08em"
                          textTransform="uppercase"
                          color={COLORS.subtle}
                        >
                          {category}
                        </Menu.ItemGroupLabel>
                        {categoryActions.map((action) => (
                          <Menu.Item
                            key={action.value}
                            value={action.value}
                            disabled={action.disabled}
                            gap="9px"
                            px="8px"
                            fontFamily="Inter, system-ui, sans-serif"
                            fontSize="13px"
                          >
                            {action.icon ? <Icon as={action.icon} boxSize="14px" color={COLORS.subtle} /> : null}
                            {action.label}
                          </Menu.Item>
                        ))}
                      </Menu.ItemGroup>
                    )
                  })}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Flex>
      </Flex>

      <Box mt="18px" display={{ base: 'block', sm: 'none' }}>
        <NativeSelect.Root size="sm">
          <NativeSelect.Field value={view} onChange={(event) => onViewChange?.(event.target.value)} aria-label="Project section">
            {VIEWS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Box>
      <Flex
        display={{ base: 'none', sm: 'inline-flex' }}
        alignSelf="flex-start"
        gap="4px"
        mt="18px"
        p="4px"
        border="1px solid"
        borderColor={COLORS.border}
        borderRadius="10px"
        bg={COLORS.hoverBg}
        role="tablist"
        aria-label="Project section"
      >
        {VIEWS.map((option) => {
          const active = view === option.value
          return (
            <Flex
              as="button"
              type="button"
              key={option.value}
              role="tab"
              align="center"
              justify="center"
              gap="7px"
              minW="132px"
              h="36px"
              px="14px"
              borderRadius="7px"
              bg={active ? COLORS.brandGreen : 'transparent'}
              boxShadow={active ? '0 2px 6px rgba(0, 101, 44, 0.2)' : undefined}
              color={active ? '#FFFFFF' : COLORS.subtle}
              cursor="pointer"
              aria-selected={active}
              onClick={() => onViewChange?.(option.value)}
              transition="background-color 120ms ease, color 120ms ease, box-shadow 120ms ease"
              _hover={{ bg: active ? '#00541F' : COLORS.surface, color: active ? '#FFFFFF' : COLORS.heading }}
              _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '1px' }}
            >
              <Icon as={option.icon} boxSize="17px" flexShrink={0} />
              <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" fontWeight="600" textAlign="center">
                {option.label}
              </Text>
            </Flex>
          )
        })}
      </Flex>
    </Card>
  )
}
