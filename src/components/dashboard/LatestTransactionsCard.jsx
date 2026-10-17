import { useState } from 'react'
import { Box, Flex, Table, Text } from '@chakra-ui/react'
import { Card } from '@/components/ui-kit/Card'
import { COLORS, CHART } from '@/theme/colors'
import { formatDate, formatNumber } from '@/utils/format'

// Rows shown at first, and how many more each "Show more" adds.
const STEP = 10

const STATUS = {
  sold: { label: 'Sold', color: CHART.sold },
  reserved: { label: 'Reserved', color: CHART.reserved },
}
const RESERVE_TYPE = { client: 'Client', company: 'Company' }

const FONT = 'Inter, system-ui, sans-serif'

/** Status reads as dot + word, never colour alone; a reservation says who it is held for. */
function StatusTag({ status, reserveType }) {
  const meta = STATUS[status] ?? { label: status, color: COLORS.subtle }
  const held = status === 'reserved' ? RESERVE_TYPE[reserveType] : ''
  return (
    <Flex align="center" gap="6px" whiteSpace="nowrap">
      <Box boxSize="7px" borderRadius="full" bg={meta.color} flexShrink={0} />
      <Text fontFamily={FONT} fontWeight="600" fontSize="12px" lineHeight="16px" color={meta.color}>
        {meta.label}
        {held ? (
          <Text as="span" fontWeight="500" color={COLORS.subtle}>
            {' '}
            · {held}
          </Text>
        ) : null}
      </Text>
    </Flex>
  )
}

function HeadCell({ children, align = 'start' }) {
  return (
    <Table.ColumnHeader
      textAlign={align}
      borderColor={COLORS.border}
      fontFamily={FONT}
      fontWeight="600"
      fontSize="11px"
      lineHeight="15px"
      letterSpacing="0.3px"
      color={COLORS.subtle}
      textTransform="none"
      py="10px"
      whiteSpace="nowrap"
    >
      {children}
    </Table.ColumnHeader>
  )
}

function Cell({ children, ...rest }) {
  return (
    <Table.Cell borderColor={COLORS.border} py="11px" verticalAlign="top" {...rest}>
      {children}
    </Table.Cell>
  )
}

const muted = (value) => value || '—'

/**
 * The latest sales and reservations, newest first, by the date each lot's
 * record carries (see recentTransactions). The portal records the day a status
 * is changed; an imported sheet may know only the month, shown as such. Lots
 * with no date cannot be placed in time, so they are counted below instead.
 */
export default function LatestTransactionsCard({ recent, projectName = '' }) {
  const [shown, setShown] = useState(STEP)
  const { rows = [], undated = 0 } = recent ?? {}
  const visible = rows.slice(0, shown)

  return (
    <Card display="flex" flexDirection="column">
      <Box mb="14px">
        <Text
          fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
          fontWeight="700"
          fontSize="16px"
          lineHeight="22px"
          letterSpacing="-0.2px"
          color={COLORS.heading}
        >
          Recent Transactions
        </Text>
        <Text mt="2px" fontFamily={FONT} fontSize="13px" lineHeight="18px" color={COLORS.subtle}>
          The latest lots sold or reserved{projectName ? ` in ${projectName}` : ''}, newest first.
        </Text>
      </Box>

      <Box overflowX="auto">
        <Table.Root size="sm" minW="720px">
          <Table.Header>
            <Table.Row bg="transparent">
              <HeadCell>Date</HeadCell>
              <HeadCell>Property</HeadCell>
              <HeadCell>Status</HeadCell>
              <HeadCell>Broker / Agent</HeadCell>
              <HeadCell>Client</HeadCell>
              <HeadCell align="end">Lot Area</HeadCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visible.map((row) => (
              <Table.Row key={row.id} bg="transparent">
                <Cell whiteSpace="nowrap">
                  <Text fontFamily={FONT} fontWeight="600" fontSize="13px" lineHeight="18px" color={COLORS.heading}>
                    {formatDate(row.date, { precision: row.datePrecision })}
                  </Text>
                </Cell>
                <Cell>
                  <Text fontFamily={FONT} fontSize="13px" lineHeight="18px" color={COLORS.heading}>
                    {row.property}
                  </Text>
                  <Text fontFamily={FONT} fontSize="11px" lineHeight="15px" color={COLORS.subtle}>
                    {row.projectName}
                  </Text>
                </Cell>
                <Cell>
                  <StatusTag status={row.status} reserveType={row.reserveType} />
                </Cell>
                <Cell>
                  <Text fontFamily={FONT} fontSize="13px" lineHeight="18px" color={row.soldBy ? COLORS.heading : COLORS.subtle}>
                    {muted(row.soldBy)}
                  </Text>
                  {row.salesAgent ? (
                    <Text fontFamily={FONT} fontSize="11px" lineHeight="15px" color={COLORS.subtle}>
                      Agent: {row.salesAgent}
                    </Text>
                  ) : null}
                </Cell>
                <Cell>
                  <Text fontFamily={FONT} fontSize="13px" lineHeight="18px" color={row.client ? COLORS.heading : COLORS.subtle}>
                    {muted(row.client)}
                  </Text>
                </Cell>
                <Cell textAlign="end" whiteSpace="nowrap">
                  <Text fontFamily={FONT} fontWeight="600" fontSize="13px" lineHeight="18px" color={COLORS.heading}>
                    {formatNumber(row.areaSqm)} sqm
                  </Text>
                </Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>

        {visible.length === 0 ? (
          <Flex justify="center" py="28px">
            <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
              No dated sales or reservations yet.
            </Text>
          </Flex>
        ) : null}
      </Box>

      <Flex align="center" justify="space-between" gap="12px" mt="14px" flexWrap="wrap">
        <Text fontFamily={FONT} fontSize="12px" lineHeight="16px" color={COLORS.subtle}>
          Showing {formatNumber(visible.length)} of {formatNumber(rows.length)}
          {/* Lots that cannot be placed in time are said, so the list is not mistaken for every sale. */}
          {undated ? ` · ${formatNumber(undated)} more sold or reserved lot${undated === 1 ? ' has' : 's have'} no date recorded` : ''}
        </Text>
        {rows.length > STEP ? (
          <Flex gap="8px">
            {shown > STEP ? (
              <Text
                as="button"
                type="button"
                onClick={() => setShown(STEP)}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="12.5px"
                color={COLORS.subtle}
                cursor="pointer"
                _hover={{ textDecoration: 'underline' }}
              >
                Show fewer
              </Text>
            ) : null}
            {shown < rows.length ? (
              <Text
                as="button"
                type="button"
                onClick={() => setShown((count) => count + STEP)}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="12.5px"
                color={COLORS.activeBg}
                cursor="pointer"
                _hover={{ textDecoration: 'underline' }}
              >
                Show more
              </Text>
            ) : null}
          </Flex>
        ) : null}
      </Flex>
    </Card>
  )
}
