import { Box, Flex, Icon, Text } from '@chakra-ui/react'
import { LuArrowRight, LuMegaphone } from 'react-icons/lu'
import { Card, CardHeading } from '@/components/ui-kit/Card'
import { COLORS } from '@/theme/colors'
import { formatDate } from '@/utils/format'

const FONT = 'Inter, system-ui, sans-serif'
const PREVIEW_CHARS = 120

/** One announcement: when and by whom, its title, and the opening of its body. */
function AnnouncementRow({ item }) {
  const long = item.body.length > PREVIEW_CHARS
  const preview = long ? `${item.body.slice(0, PREVIEW_CHARS).trimEnd()}…` : item.body

  return (
    <Box borderLeft="2px solid" borderColor={COLORS.border} pl="12px">
      <Text fontFamily={FONT} fontSize="11px" lineHeight="15px" color={COLORS.subtle}>
        {formatDate(item.createdAt) || '—'}
        {item.author ? ` · ${item.author}` : ''}
      </Text>
      <Text mt="2px" fontFamily={FONT} fontWeight="600" fontSize="13px" lineHeight="18px" color={COLORS.heading} truncate>
        {item.title}
      </Text>
      {preview ? (
        <Text mt="2px" fontFamily={FONT} fontSize="12px" lineHeight="17px" color={COLORS.muted} lineClamp={2}>
          {preview}
        </Text>
      ) : null}
    </Box>
  )
}

/**
 * The announcements board in brief — the newest few, with a way through to the
 * page itself. The dashboard summarises the portal, and a notice nobody has read
 * is the one thing a summary should not leave out.
 *
 * `onOpen` is how the page is reached: the app switches pages by state rather
 * than by URL, so there is no link to point at.
 */
export default function AnnouncementsCard({ announcements, onOpen }) {
  const items = announcements?.items ?? []
  const total = announcements?.total ?? 0
  const more = Math.max(0, total - items.length)

  return (
    <Card>
      <CardHeading
        title="Announcements"
        description={total ? `${total} posted${more ? ` · newest ${items.length} shown` : ''}` : 'Nothing posted yet'}
        actions={
          onOpen ? (
            <Flex
              as="button"
              type="button"
              onClick={onOpen}
              align="center"
              gap="4px"
              fontFamily={FONT}
              fontWeight="600"
              fontSize="12.5px"
              color={COLORS.activeBg}
              cursor="pointer"
              _hover={{ textDecoration: 'underline' }}
              _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
            >
              View all
              <Icon as={LuArrowRight} boxSize="13px" />
            </Flex>
          ) : null
        }
      />
      {items.length ? (
        <Flex direction="column" gap="14px">
          {items.map((item) => (
            <AnnouncementRow key={item.id} item={item} />
          ))}
        </Flex>
      ) : (
        <Flex direction="column" align="center" justify="center" gap="6px" py="28px" textAlign="center">
          <Icon as={LuMegaphone} boxSize="22px" color={COLORS.subtle} />
          <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
            No announcements have been posted.
          </Text>
        </Flex>
      )}
    </Card>
  )
}
