import { Box, Flex, Menu, Portal, Text } from '@chakra-ui/react'
import { LuDownload, LuSlidersHorizontal } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import ToolbarButton from '@/components/ui-kit/ToolbarButton'
import { COLORS } from '@/theme/colors'

/**
 * `projects`, `project` and `onExport` drive the two buttons in the corner.
 * Filters opens a menu over the same state the transactions table reads, and
 * Export writes out exactly what those filters leave — so both controls
 * describe one set of movements rather than two.
 *
 * There is no date range: the lot tables hold no record of when a lot moved,
 * only a `last_updated` stamp that is empty on most rows, so every window built
 * on it hid stock rather than narrowing it.
 */
export default function PortfolioHero({ projects = [], project = 'overall', onProjectChange, onExport }) {
  // Said on the button itself, so a narrowed dashboard is never silent about it.
  const active = project !== 'overall' ? 1 : 0

  return (
    <Card p="24px">
      <Flex align="flex-start" justify="space-between" gap="20px" flexWrap="wrap">
        <Box minW="260px" flex="1">
          <Text
            as="h2"
            fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
            fontWeight="700"
            fontSize="22px"
            lineHeight="28px"
            letterSpacing="-0.4px"
            color={COLORS.heading}
          >
            VHBC Portfolio Performance
          </Text>
          <Text
            mt="6px"
            maxW="52ch"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="13px"
            lineHeight="19px"
            color={COLORS.subtle}
          >
            Real-time inventory movement, booking velocity, and projected settlement capital across
            master-planned communities.
          </Text>
        </Box>

        <Flex align="center" gap="10px" flexWrap="wrap">
          <Menu.Root closeOnSelect={false} positioning={{ placement: 'bottom-end', gutter: 6 }}>
            <Menu.Trigger asChild>
              <ToolbarButton icon={LuSlidersHorizontal}>{active ? `Filters (${active})` : 'Filters'}</ToolbarButton>
            </Menu.Trigger>
            <Portal>
              {/* Anchored under the button and aligned to its right edge, so the
                  menu cannot hang off the side of a narrow window. */}
              <Menu.Positioner>
                <Menu.Content minW="210px" p="6px">
                  <Menu.ItemGroup>
                    <Menu.ItemGroupLabel fontSize="11px" color={COLORS.subtle}>
                      Project
                    </Menu.ItemGroupLabel>
                    <Menu.RadioItemGroup
                      value={project}
                      onValueChange={({ value }) => onProjectChange?.(value)}
                    >
                      <Menu.RadioItem value="overall" fontSize="13px">
                        <Menu.ItemIndicator />
                        Overall
                      </Menu.RadioItem>
                      {projects.map((option) => (
                        <Menu.RadioItem key={option.code} value={option.code} fontSize="13px">
                          <Menu.ItemIndicator />
                          {option.name}
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioItemGroup>
                  </Menu.ItemGroup>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>

          <ToolbarButton icon={LuDownload} variant="primary" onClick={onExport}>
            Export
          </ToolbarButton>
        </Flex>
      </Flex>
    </Card>
  )
}
