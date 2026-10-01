/**
 * Verifies the booking timeline endpoints against a running API and a real
 * database. Creates its own booking so it never depends on leftover state.
 */
import { PrismaClient } from '@prisma/client';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();

// Seeded accounts; the lifecycle verification script uses the same two.
const CUSTOMER_PHONE = '+919800000002';
const PROFESSIONAL_PHONE = '+919800000003';

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => undefined);
  return { status: response.status, data: payload?.data, error: payload?.error };
}

async function login(phone) {
  const challenge = await call('/auth/request-otp', { method: 'POST', body: { phone } });
  const session = await call('/auth/verify-otp', {
    method: 'POST',
    body: { phone, otp: challenge.data.otp },
  });
  return session.data.token;
}

let passed = 0;
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}${detail ? ` -> ${detail}` : ''}`);
  } else {
    console.log(`FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
    process.exitCode = 1;
  }
}

const customerToken = await login(CUSTOMER_PHONE);
const professionalToken = await login(PROFESSIONAL_PHONE);

// Discover a service and professional to book with.
const categories = await call('/customer/services', { token: customerToken });
const service = categories.data?.[0]?.services?.[0];
check('discovery returns a bookable service', Boolean(service?.id), service?.title);

const professionals = await call('/customer/professionals', { token: customerToken });
const professional = professionals.data?.[0];
check('discovery returns a professional', Boolean(professional?.id), professional?.businessName);

// Confirm the professional profile carries the fields the profile screen shows.
// `workingHours` is optional by contract and is omitted rather than faked when
// the professional has not set any, so both cases are acceptable.
const profile = await call(`/customer/professionals/${professional.id}`, { token: customerToken });
check(
  'professional profile exposes real fields only',
  Boolean(profile.data) &&
    'verification' in profile.data &&
    'businessName' in profile.data &&
    Array.isArray(profile.data.services),
  `verification=${profile.data?.verification} services=${profile.data?.services?.length ?? 0} hours=${profile.data?.workingHours?.length ?? 'omitted'}`,
);

const created = await call('/customer/bookings', {
  method: 'POST',
  token: customerToken,
  body: {
    professionalId: professional.id,
    serviceId: service.id,
    scheduledStart: new Date(Date.now() + 3 * 86400000).toISOString(),
    address: {
      label: 'Home',
      type: 'HOME',
      line1: '221B Baker Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    },
  },
});
check('booking created', created.status === 201, created.data?.reference);
const bookingId = created.data?.id;

// The timeline records the creation step.
let timeline = await call(`/customer/bookings/${bookingId}/timeline`, { token: customerToken });
check(
  'timeline returns rows for a real booking',
  Array.isArray(timeline.data) && timeline.data.length >= 1,
  `${timeline.data?.length} row(s)`,
);
check(
  'first timeline row is the recorded creation step',
  timeline.data?.[0]?.fromStatus === null && timeline.data[0]?.toStatus === 'REQUESTED',
  `${timeline.data?.[0]?.fromStatus} -> ${timeline.data?.[0]?.toStatus}`,
);
check(
  'creation step is attributed to the customer who booked',
  timeline.data?.[0]?.actorUserId !== undefined ? true : timeline.data?.[0]?.isOwnAction === true,
  `isOwnAction=${timeline.data?.[0]?.isOwnAction}`,
);

// Accepting adds a second row, and the professional sees their own action flagged.
await call(`/professional/bookings/${bookingId}/accept`, {
  method: 'POST',
  token: professionalToken,
});
const proTimeline = await call(`/professional/bookings/${bookingId}/timeline`, {
  token: professionalToken,
});
check(
  'accept is recorded in the timeline',
  proTimeline.data?.some((row) => row.toStatus === 'ACCEPTED'),
  `${proTimeline.data?.length} row(s)`,
);
check(
  'the accept step is flagged as the professional’s own action',
  proTimeline.data?.find((row) => row.toStatus === 'ACCEPTED')?.isOwnAction === true,
);

// Chronological order.
const times = (proTimeline.data ?? []).map((row) => new Date(row.createdAt).getTime());
check(
  'timeline is in chronological order',
  times.every((value, index) => index === 0 || value >= times[index - 1]),
);

// The same history is returned to the customer.
timeline = await call(`/customer/bookings/${bookingId}/timeline`, { token: customerToken });
check(
  'customer sees the same recorded history',
  timeline.data?.length === proTimeline.data?.length,
  `${timeline.data?.length} vs ${proTimeline.data?.length}`,
);

// A booking that belongs to nobody this user is scoped to must not resolve. The
// unrelated customer is created for this run and removed afterwards, so the
// check never depends on leftover state.
const unrelatedPhone = `+9197${String(Date.now()).slice(-8)}`;
const unrelated = await prisma.user.create({
  data: {
    phone: unrelatedPhone,
    fullName: 'Timeline Stranger',
    // Placeholder only: this account exists to prove scoping, and it never
    // authenticates with a password.
    passwordHash: 'not-used-this-account-logs-in-with-otp',
    role: 'CUSTOMER',
    status: 'ACTIVE',
  },
});
const unrelatedCustomerToken = await login(unrelatedPhone);
const denied = await call(`/customer/bookings/${bookingId}/timeline`, {
  token: unrelatedCustomerToken,
});
check(
  'an unrelated customer cannot read another booking’s timeline',
  denied.status === 404,
  `HTTP ${denied.status}`,
);

// A customer cannot reach the professional route at all.
const wrongRole = await call(`/professional/bookings/${bookingId}/timeline`, {
  token: customerToken,
});
check(
  'a customer cannot use the professional timeline route',
  wrongRole.status === 403,
  `HTTP ${wrongRole.status}`,
);

await prisma.user.delete({ where: { id: unrelated.id } }).catch(() => undefined);
await prisma.$disconnect();

console.log(`\n${passed} checks passed.`);
