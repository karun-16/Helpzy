/**
 * Real vertical-flow check for the booking lifecycle.
 *
 * Runs against the live API and a real PostgreSQL database, and is the manual
 * proof that REQUESTED -> ACCEPTED -> SCHEDULED -> ON_THE_WAY -> IN_PROGRESS
 * -> COMPLETED_BY_PROFESSIONAL -> CUSTOMER_CONFIRMED works end to end with one
 * status-history row per step. The automated e2e suites cover the same rules
 * against a mocked Prisma client; this one covers the real database.
 *
 * Usage (from backend/api):
 *   node scripts/verify-booking-lifecycle.mjs
 */
import { PrismaClient } from '@prisma/client';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';
const CUSTOMER_PHONE = '+919800000002';
const PROFESSIONAL_PHONE = '+919800000003';

const prisma = new PrismaClient();

async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, data: payload.data, error: payload.error };
}

async function login(phone) {
  const challenge = await call('/auth/request-otp', { method: 'POST', body: { phone } });
  if (challenge.status !== 200 || !challenge.data?.otp) {
    throw new Error(`Could not request an OTP for ${phone}: ${JSON.stringify(challenge)}`);
  }
  const session = await call('/auth/verify-otp', {
    method: 'POST',
    body: { phone, otp: challenge.data.otp },
  });
  if (session.status !== 200) {
    throw new Error(`Could not verify the OTP for ${phone}: ${JSON.stringify(session)}`);
  }
  return session.data.token;
}

const results = [];
function check(label, condition, detail = '') {
  results.push({ label, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`);
}

const customerToken = await login(CUSTOMER_PHONE);
const professionalToken = await login(PROFESSIONAL_PHONE);

const customer = await prisma.user.findUniqueOrThrow({ where: { phone: CUSTOMER_PHONE } });
const professionalUser = await prisma.user.findUniqueOrThrow({
  where: { phone: PROFESSIONAL_PHONE },
});
const professional = await prisma.professionalProfile.findUniqueOrThrow({
  where: { userId: professionalUser.id },
});

/**
 * Always creates a fresh booking through the API so the whole sequence,
 * including the initial `REQUESTED` row, is produced by the application rather
 * than inherited from a seeded row. The slot is derived from the professional's
 * latest booking to respect the `bookings_professional_slot_key` unique index.
 */
async function createAndAcceptBooking() {
  const service = await prisma.service.findFirst({
    where: { ownerId: professionalUser.id, isActive: true },
  });
  if (!service) {
    throw new Error(
      'The seeded professional owns no active service, so a booking cannot be created.',
    );
  }

  const latest = await prisma.booking.findFirst({
    where: { professionalId: professional.id },
    orderBy: { scheduledStart: 'desc' },
    select: { scheduledStart: true },
  });
  const day = 86_400_000;
  const scheduledStart = new Date(
    Math.max(latest?.scheduledStart.getTime() ?? 0, Date.now()) + 2 * day,
  );

  const created = await call('/customer/bookings', {
    method: 'POST',
    token: customerToken,
    body: {
      professionalId: professionalUser.id,
      serviceId: service.id,
      scheduledStart: scheduledStart.toISOString(),
      address: {
        label: 'Home',
        line1: '221B Baker Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
      },
    },
  });
  if (created.status !== 201) {
    throw new Error(`Could not create a booking: ${JSON.stringify(created)}`);
  }
  check('creates a REQUESTED booking', created.data.status === 'REQUESTED', created.data.status);

  const accepted = await call(`/professional/bookings/${created.data.id}/accept`, {
    method: 'POST',
    token: professionalToken,
  });
  if (accepted.status !== 201) {
    throw new Error(`Could not accept the booking: ${JSON.stringify(accepted)}`);
  }
  check(
    'professional accepts to ACCEPTED',
    accepted.data.status === 'ACCEPTED',
    accepted.data.status,
  );

  return prisma.booking.findUniqueOrThrow({ where: { id: created.data.id } });
}

const booking = await createAndAcceptBooking();
console.log(`\nBooking ${booking.reference} (${booking.id}) starts at ${booking.status}.`);

const PROFESSIONAL_ACTIONS = [
  'SCHEDULED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'COMPLETED_BY_PROFESSIONAL',
];

console.log('\nProfessional-controlled lifecycle steps');
for (const action of PROFESSIONAL_ACTIONS) {
  const result = await call(`/professional/bookings/${booking.id}/advance`, {
    method: 'POST',
    token: professionalToken,
    body: { action },
  });
  const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  check(
    `professional advances the booking to ${action}`,
    result.status === 201 && stored.status === action,
    `HTTP ${result.status}, stored ${stored.status}`,
  );
}

console.log('\nCustomer confirmation');
const beforeConfirm = await call(`/customer/bookings/${booking.id}`, { token: customerToken });
check(
  'customer sees COMPLETED_BY_PROFESSIONAL',
  beforeConfirm.data?.status === 'COMPLETED_BY_PROFESSIONAL',
  beforeConfirm.data?.status ?? beforeConfirm.error?.code,
);

const confirmed = await call(`/customer/bookings/${booking.id}/confirm`, {
  method: 'POST',
  token: customerToken,
});
const afterConfirm = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
check(
  'customer confirms to CUSTOMER_CONFIRMED',
  confirmed.status === 201 && afterConfirm.status === 'CUSTOMER_CONFIRMED',
  `HTTP ${confirmed.status}, stored ${afterConfirm.status}`,
);

const confirmedDetail = await call(`/customer/bookings/${booking.id}`, { token: customerToken });
check(
  'customer detail reports CUSTOMER_CONFIRMED',
  confirmedDetail.data?.status === 'CUSTOMER_CONFIRMED',
  confirmedDetail.data?.status ?? confirmedDetail.error?.code,
);

console.log('\nAuthorization and ordering against the real database');
const outOfOrder = await call(`/professional/bookings/${booking.id}/advance`, {
  method: 'POST',
  token: professionalToken,
  body: { action: 'IN_PROGRESS' },
});
check(
  'rejects an out-of-order professional step',
  outOfOrder.status === 409,
  `HTTP ${outOfOrder.status} ${outOfOrder.error?.code ?? ''}`,
);

const repeatConfirm = await call(`/customer/bookings/${booking.id}/confirm`, {
  method: 'POST',
  token: customerToken,
});
check(
  'rejects a second confirmation',
  repeatConfirm.status === 409,
  `HTTP ${repeatConfirm.status} ${repeatConfirm.error?.code ?? ''}`,
);

const adminToken = await login('+919800000001');
const adminAttempt = await call(`/professional/bookings/${booking.id}/advance`, {
  method: 'POST',
  token: adminToken,
  body: { action: 'SCHEDULED' },
});
check(
  'admin cannot drive the professional endpoint',
  adminAttempt.status === 403,
  `HTTP ${adminAttempt.status}`,
);

const otherProfessionalToken = await login('+919800000004');
const otherProfessionalAttempt = await call(`/professional/bookings/${booking.id}/advance`, {
  method: 'POST',
  token: otherProfessionalToken,
  body: { action: 'SCHEDULED' },
});
check(
  "an unrelated professional cannot advance someone else's booking",
  otherProfessionalAttempt.status === 404,
  `HTTP ${otherProfessionalAttempt.status}`,
);

// The seed only ships one customer, so a second is provisioned to prove the
// ownership rule. The booking stays untouched either way.
const OTHER_CUSTOMER_PHONE = '+919800000099';
const otherCustomer = await prisma.user.upsert({
  where: { phone: OTHER_CUSTOMER_PHONE },
  update: {},
  create: {
    phone: OTHER_CUSTOMER_PHONE,
    fullName: 'Unrelated Customer',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    passwordHash: 'seeded-by-verify-script',
  },
});
await prisma.customerProfile.upsert({
  where: { userId: otherCustomer.id },
  update: {},
  create: { userId: otherCustomer.id },
});

const otherCustomerToken = await login(OTHER_CUSTOMER_PHONE);
const otherCustomerAttempt = await call(`/customer/bookings/${booking.id}/confirm`, {
  method: 'POST',
  token: otherCustomerToken,
});
check(
  "an unrelated customer cannot confirm someone else's booking",
  otherCustomerAttempt.status === 404,
  `HTTP ${otherCustomerAttempt.status}`,
);

console.log('\nStatus history in PostgreSQL');
const history = await prisma.bookingStatusHistory.findMany({
  where: { bookingId: booking.id },
  orderBy: { createdAt: 'asc' },
});
for (const entry of history) {
  console.log(
    `  ${entry.createdAt.toISOString()}  ${entry.fromStatus ?? '(none)'} -> ${entry.toStatus}  by ${entry.actorUserId}`,
  );
}

const expectedSequence = [
  'REQUESTED',
  'ACCEPTED',
  'SCHEDULED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'COMPLETED_BY_PROFESSIONAL',
  'CUSTOMER_CONFIRMED',
];
check(
  'history contains the full lifecycle in order',
  JSON.stringify(history.map((entry) => entry.toStatus)) === JSON.stringify(expectedSequence),
  history.map((entry) => entry.toStatus).join(' -> '),
);

const professionalSteps = history.filter(
  (entry) => entry.toStatus !== 'CUSTOMER_CONFIRMED' && entry.toStatus !== 'REQUESTED',
);
check(
  'every professional step was recorded by the professional user',
  professionalSteps.every((entry) => entry.actorUserId === professionalUser.id),
  professionalSteps.map((entry) => entry.toStatus).join(', '),
);
check(
  'the confirmation was recorded by the customer user',
  history.at(-1)?.actorUserId === customer.id,
  history.at(-1)?.actorUserId,
);

await prisma.$disconnect();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exitCode = failed.length === 0 ? 0 : 1;
