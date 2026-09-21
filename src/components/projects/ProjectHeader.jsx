import { Box, Flex, Icon, Menu, NativeSelect, Portal, Text } from '@chakra-ui/react'
import {
  LuChevronDown,
  LuFolderKanban,
  LuHammer,
  LuMap,
  LuSparkles,
  LuMapPin,
  LuNewspaper,
  LuMountain,
  LuTable2,
} from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import SegmentedControl from '@/components/ui-kit/SegmentedControl'
import { COLORS } from '@/theme/colors'
import { formatNumber } from '@/utils/format'

const VIEWS = [
  { value: 'table', label: 'Lot Table', icon: LuTable2 },
  { value: 'map', label: 'Map', icon: LuMap },
  { value: 'project-dev', label: 'Project Development', icon: LuHammer },
  { value: 'future-dev', label: 'Future Development', icon: LuSparkles },
  { value: 'flyers', label: 'Flyers Pictures', icon: LuNewspaper },
]

function Dot() {
  return <Box boxSize="3px" borderRadius="full" bg="#C4CAD4" flexShrink={0} aria-hidden="true" />
}

function MetaText({ label, value }) {
  return (
    <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" lineHeight="18px" color={COLORS.subtle}>
      {label}{' '}
      <Text as="span" fontWeight="600" color={COLORS.heading}>
        {value}
      </Text>
    </Text>
  )
}

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
  const area = project.grossAreaHectares
    ? `${formatNumber(project.grossAreaHectares)} Hectares`
    : '—'

  return (
    <Card p="24px">
      <Flex align="center" justify="space-between" gap="20px" flexWrap="wrap">
        <Flex align="center" gap="16px" minW="280px" flex="1">
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

        <Flex align="center" gap="10px" flexWrap="wrap">
          {projects.length ? (
            <NativeSelect.Root size="sm" w="auto" minW="170px">
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

          <SegmentedControl
            options={VIEWS}
            value={view}
            onChange={onViewChange}
            activeColor={COLORS.brandGreen}
          />

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
                <Menu.Content minW="200px">
                  {actions.map((action) => (
                    <Menu.Item
                      key={action.value}
                      value={action.value}
                      disabled={action.disabled}
                      gap="8px"
                      fontFamily="Inter, system-ui, sans-serif"
                      fontSize="13px"
                    >
                      {action.icon ? <Icon as={action.icon} boxSize="14px" /> : null}
                      {action.label}
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Flex>
      </Flex>
    </Card>
  )
}
