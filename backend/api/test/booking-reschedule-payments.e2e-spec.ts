import {
  BOOKING_ID,
  CUSTOMER_ID,
  PROFESSIONAL_USER_ID,
  createBookingFlowsHarness,
  hoursFromNow,
  type Harness,
} from './harness/booking-flows.harness';
import { SandboxPaymentGateway } from '../src/payments/payment-gateway.service';

/**
 * Rescheduling, mutual completion, cash settlement, gateway settlement and
 * verification documents.
 *
 * These are the flows where a mistake loses money or strands a booking, so the
 * tests assert the properties that protect the parties rather than the shape of
 * each response: a proposal never moves an appointment before it is agreed,
 * neither party can answer their own proposal, one confirmation never settles a
 * booking or a cash payment, and only a signed provider callback can mark a
 * payment verified.
 */
describe('Rescheduling, completion and payments (e2e)', () => {
  let harness: Harness;

  // Assigned in `beforeAll` alongside the harness, so every test reads the same
  // live object the Prisma doubles mutate.
  let state: Harness['state'];

  const api = () => harness.api();
  const as = (role: Parameters<Harness['as']>[0]) => harness.as(role);

  beforeAll(async () => {
    harness = await createBookingFlowsHarness();
    state = harness.state;
  }, 30_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await harness.app.close();
  });

  beforeEach(() => {
    state.booking = harness.baseBooking();
    state.payment = null;
    state.proposal = null;
    state.documents = [];
    state.documentReviews = [];
    harness.history.length = 0;
    harness.attempts.length = 0;
    harness.auditLog.length = 0;
    harness.notifications.length = 0;
    harness.webhookEvents.clear();
    // Call history must be cleared too, so a test asserting "this was never
    // written" is not reading an earlier test's calls.
    jest.clearAllMocks();
  });

  describe('rescheduling', () => {
    const proposedStart = () => hoursFromNow(72).toISOString();

    it('lets either party propose a new time', async () => {
      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart(), reason: 'I am away that morning.' })
        .expect(201);

      expect(response.body.data.status).toBe('PENDING');
      expect(response.body.data.requestedById).toBe(CUSTOMER_ID);
    });

    it('does not move the confirmed appointment until it is accepted', async () => {
      const original = (state.booking!.scheduledStart as Date).toISOString();
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      // The proposal exists, but the booking's own schedule is untouched.
      expect((state.booking!.scheduledStart as Date).toISOString()).toBe(original);
      expect(state.booking!.status).toBe('RESCHEDULE_PENDING');
    });

    it('tells the other party, not the proposer', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      expect(harness.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BOOKING_RESCHEDULE_REQUESTED',
            userId: PROFESSIONAL_USER_ID,
          }),
        ]),
      );
    });

    it('moves the appointment and records the decision on acceptance', async () => {
      // Captured once: the proposal and the comparison must use the same instant.
      const agreed = proposedStart();
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: agreed })
        .expect(201);

      const decision = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule/decide`)
        .set(as('PROFESSIONAL'))
        .send({ decision: 'ACCEPTED' })
        .expect(201);

      expect(decision.body.data.status).toBe('ACCEPTED');
      // Now, and only now, has the appointment actually moved.
      expect((state.booking!.scheduledStart as Date).toISOString()).toBe(agreed);
      // RESCHEDULE_PENDING is a pause, so the job returns to where it was.
      expect(state.booking!.status).toBe('SCHEDULED');
      expect(state.proposal!.status).toBe('ACCEPTED');
    });

    it('restores the original time on rejection', async () => {
      const original = (state.booking!.scheduledStart as Date).toISOString();
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule/decide`)
        .set(as('PROFESSIONAL'))
        .send({ decision: 'REJECTED', decisionNote: 'I am booked then.' })
        .expect(201);

      expect((state.booking!.scheduledStart as Date).toISOString()).toBe(original);
      expect(state.booking!.status).toBe('SCHEDULED');
      expect(state.proposal!.decisionNote).toBe('I am booked then.');
    });

    it('refuses a rejection that does not say why', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule/decide`)
        .set(as('PROFESSIONAL'))
        .send({ decision: 'REJECTED' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('stops a proposer answering their own proposal', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule/decide`)
        .set(as('CUSTOMER'))
        .send({ decision: 'ACCEPTED' })
        .expect(409);

      expect(response.body.error.message).toContain('your own reschedule request');
    });

    it('allows the proposer to withdraw but not the other party', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule/withdraw`)
        .set(as('PROFESSIONAL'))
        .expect(409);

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule/withdraw`)
        .set(as('CUSTOMER'))
        .expect(201);

      expect(state.proposal!.status).toBe('WITHDRAWN');
      expect(state.booking!.status).toBe('SCHEDULED');
    });

    it('tells the party who was asked to answer that the request was withdrawn', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule/withdraw`)
        .set(as('CUSTOMER'))
        .expect(201);

      /*
       * The recipient is the other party, and the wording is a withdrawal rather
       * than a decline: nobody refused anything. The proposer being told "your
       * request was declined" - or nothing being told at all - are both wrong here.
       */
      const withdrawal = harness.notifications.filter(
        (entry) => entry.type === 'BOOKING_RESCHEDULE_WITHDRAWN',
      );
      expect(withdrawal).toHaveLength(1);
      expect(withdrawal[0]!.userId).toBe(PROFESSIONAL_USER_ID);
      expect(
        harness.notifications.some(
          (entry) => entry.type === 'BOOKING_RESCHEDULE_WITHDRAWN' && entry.userId === CUSTOMER_ID,
        ),
      ).toBe(false);
    });

    it('refuses a proposal on a booking that changed since it was read', async () => {
      /*
       * The booking's status is read before the transaction and the claim is
       * guarded on it inside. Here the double reports the guard as matching nothing,
       * which is what a booking cancelled in between two requests looks like.
       * Resuming such a booking would move it to RESCHEDULE_PENDING, and the later
       * acceptance would then move a booking that should have stayed terminal.
       */
      harness.modelMethod('booking', 'updateMany').mockResolvedValueOnce({ count: 0 });

      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() });

      expect(response.status).toBe(409);
      expect(state.proposal).toBeNull();
      expect(state.booking!.status).toBe('SCHEDULED');
    });

    it('lets the proposer ask again after withdrawing', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule/withdraw`)
        .set(as('CUSTOMER'))
        .expect(201);

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: hoursFromNow(96).toISOString() })
        .expect(201);
    });

    it('rejects a second proposal while one is already waiting', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('PROFESSIONAL'))
        .send({ proposedStart: hoursFromNow(96).toISOString() })
        .expect(409);

      expect(response.body.error.message).toContain('already a reschedule request');
    });

    it('rejects a proposal for a past time or for the slot already booked', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: hoursFromNow(-2).toISOString() })
        .expect(409);

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: (state.booking!.scheduledStart as Date).toISOString() })
        .expect(409);
    });

    it('will not reschedule a job that is already under way', async () => {
      state.booking = harness.baseBooking({ status: 'ON_THE_WAY' });

      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(409);

      expect(response.body.error.message).toContain('cannot be rescheduled');
    });

    it('hides the flow from somebody who is not a party to the booking', async () => {
      state.booking = harness.baseBooking({ customerId: 'b1000000-0000-4000-8000-000000000009' });

      await api().get(`/api/v1/bookings/${BOOKING_ID}/reschedule`).set(as('CUSTOMER')).expect(404);
    });

    it('reports who may do what, so the app never guesses', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: proposedStart() })
        .expect(201);

      const forProposer = await api()
        .get(`/api/v1/bookings/${BOOKING_ID}/reschedule/state`)
        .set(as('CUSTOMER'))
        .expect(200);
      // The proposer may withdraw but must not answer their own request.
      expect(forProposer.body.data.canWithdraw).toBe(true);
      expect(forProposer.body.data.canDecide).toBe(false);
      expect(forProposer.body.data.canRequest).toBe(false);

      const forOtherParty = await api()
        .get(`/api/v1/bookings/${BOOKING_ID}/reschedule/state`)
        .set(as('PROFESSIONAL'))
        .expect(200);
      expect(forOtherParty.body.data.canDecide).toBe(true);
      expect(forOtherParty.body.data.canWithdraw).toBe(false);
    });
  });

  describe('mutual completion', () => {
    it('waits for the customer after only the professional confirms', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });

      const response = await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      expect(response.body.data.isComplete).toBe(false);
      expect(response.body.data.professionalConfirmedAt).not.toBeNull();
      expect(response.body.data.customerConfirmedAt).toBeNull();
      // The booking is not complete until the customer agrees.
      expect(state.booking!.status).toBe('COMPLETED_BY_PROFESSIONAL');
    });

    it('completes only once both have confirmed', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });
      await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      const response = await api()
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/complete`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);

      expect(response.body.data.isComplete).toBe(true);
      expect(state.booking!.status).toBe('CUSTOMER_CONFIRMED');
    });

    it('records who confirmed and when', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });
      await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      expect(state.booking!.completedByProfessionalId).toBe(PROFESSIONAL_USER_ID);
      expect(state.booking!.completedByProfessionalAt).toBeInstanceOf(Date);
    });

    it('asks the customer to confirm once the professional is done', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });
      await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      expect(harness.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'COMPLETION_AWAITING_CUSTOMER', userId: CUSTOMER_ID }),
        ]),
      );
    });

    it('treats a repeated confirmation as a no-op, not a second step', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });
      await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);
      const historyAfterFirst = harness.history.length;

      const repeat = await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      expect(repeat.body.data.isComplete).toBe(false);
      // No duplicate history entry from the repeated tap.
      expect(harness.history.length).toBe(historyAfterFirst);
    });

    it('refuses a confirmation that arrives out of order', async () => {
      // The customer cannot confirm before the professional has finished.
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });

      await api()
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/complete`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(409);
    });

    it('keeps completion and payment as separate steps', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });
      await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);
      await api()
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/complete`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);

      // Completing the work does not by itself record a payment.
      expect(state.payment).toBeNull();
      expect(state.booking!.status).toBe('CUSTOMER_CONFIRMED');
    });

    it('reports the completion state to the customer without them changing it', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });
      await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      const response = await api()
        .get(`/api/v1/customer/bookings/${BOOKING_ID}/completion`)
        .set(as('CUSTOMER'))
        .expect(200);

      // This is what stops the app telling someone the job is complete when only
      // one side has confirmed.
      expect(response.body.data.isComplete).toBe(false);
      expect(response.body.data.awaitingViewerConfirmation).toBe(true);
      expect(response.body.data.professionalConfirmedAt).not.toBeNull();
      expect(response.body.data.customerConfirmedAt).toBeNull();
      // A read must never be a write.
      expect(state.booking!.completedByCustomerId).toBeFalsy();
    });

    it('stops telling the professional they owe a confirmation once they gave it', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });
      await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/complete`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      const response = await api()
        .get(`/api/v1/professional/bookings/${BOOKING_ID}/completion`)
        .set(as('PROFESSIONAL'))
        .expect(200);

      expect(response.body.data.awaitingViewerConfirmation).toBe(false);
      expect(response.body.data.isComplete).toBe(false);
    });

    it('keeps a stranger out of the completion record', async () => {
      state.booking = harness.baseBooking({
        status: 'IN_PROGRESS',
        customerId: 'b1000000-0000-4000-8000-000000000009',
        professionalId: 'b9000000-0000-4000-8000-000000000001',
        professional: {
          id: 'b9000000-0000-4000-8000-000000000001',
          userId: 'b2000000-0000-4000-8000-000000000009',
          user: { id: 'b2000000-0000-4000-8000-000000000009', fullName: 'Other Pro' },
          businessName: 'Other Pro Home Care',
        },
      });

      // Ownership is resolved from the session, so a third party learns nothing -
      // not even that this booking exists.
      await api()
        .get(`/api/v1/customer/bookings/${BOOKING_ID}/completion`)
        .set(as('CUSTOMER'))
        .expect(404);
      await api()
        .get(`/api/v1/professional/bookings/${BOOKING_ID}/completion`)
        .set(as('PROFESSIONAL'))
        .expect(404);
    });

    it('records the evidence when the professional uses the generic advance route', async () => {
      state.booking = harness.baseBooking({ status: 'IN_PROGRESS' });

      await api()
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set(as('PROFESSIONAL'))
        .send({ action: 'COMPLETED_BY_PROFESSIONAL' })
        .expect(201);

      // `advance` is how every client reaches this step, so it cannot leave a
      // booking reading "completed" with no record of who completed it.
      expect(state.booking!.status).toBe('COMPLETED_BY_PROFESSIONAL');
      expect(state.booking!.completedByProfessionalId).toBe(PROFESSIONAL_USER_ID);
      expect(state.booking!.completedByProfessionalAt).toBeInstanceOf(Date);
    });

    it('records the evidence when the customer uses the legacy confirm route', async () => {
      state.booking = harness.baseBooking({
        status: 'COMPLETED_BY_PROFESSIONAL',
        completedByProfessionalId: PROFESSIONAL_USER_ID,
        completedByProfessionalAt: new Date(),
      });

      await api()
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);

      // `/confirm` predates the handshake. It still answers, and it must not leave
      // the booking reporting a confirmation that was never recorded.
      expect(state.booking!.status).toBe('CUSTOMER_CONFIRMED');
      expect(state.booking!.completedByCustomerId).toBe(CUSTOMER_ID);
      expect(state.booking!.completedByCustomerAt).toBeInstanceOf(Date);
    });
  });

  describe('cash payments', () => {
    beforeEach(() => {
      state.booking = harness.baseBooking({ status: 'PAYMENT_PENDING' });
      state.payment = harness.basePayment({ method: 'CASH', status: 'PENDING' });
    });

    it('does not settle on a single confirmation', async () => {
      const response = await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);

      expect(response.body.data.cash.isSettled).toBe(false);
      expect(response.body.data.cash.customerConfirmedAt).not.toBeNull();
      expect(response.body.data.cash.professionalConfirmedAt).toBeNull();
      // Neither the payment nor the booking may move on one party's word.
      expect(state.payment!.status).toBe('PENDING');
      expect(state.booking!.status).toBe('PAYMENT_PENDING');
    });

    it('asks the other party to confirm after the first one', async () => {
      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);

      expect(harness.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'PAYMENT_AWAITING_BOTH',
            userId: PROFESSIONAL_USER_ID,
          }),
        ]),
      );
    });

    it('settles once both parties agree', async () => {
      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);

      const response = await api()
        .post(`/api/v1/professional/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('PROFESSIONAL'))
        .send({ note: 'Received in full.' })
        .expect(201);

      expect(response.body.data.cash.isSettled).toBe(true);
      expect(state.payment!.status).toBe('PAID');
      expect(state.booking!.status).toBe('PAID');
    });

    it('records who confirmed and when', async () => {
      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);
      await api()
        .post(`/api/v1/professional/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      expect(state.payment!.cashConfirmedByCustomerId).toBe(CUSTOMER_ID);
      expect(state.payment!.cashConfirmedByProfessionalId).toBe(PROFESSIONAL_USER_ID);
      expect(state.payment!.cashConfirmedByCustomerAt).toBeInstanceOf(Date);
    });

    it('never marks a cash payment gateway-verified', async () => {
      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);
      const response = await api()
        .post(`/api/v1/professional/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      // Cash is settled by agreement, not by a provider.
      expect(response.body.data.gatewayVerified).toBe(false);
      expect(state.payment!.gatewayVerified).toBe(false);
    });

    it('treats a repeated confirmation as a no-op', async () => {
      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);
      const attemptsAfterFirst = harness.attempts.length;

      const repeat = await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);

      expect(repeat.body.data.cash.isSettled).toBe(false);
      expect(harness.attempts.length).toBe(attemptsAfterFirst);
    });

    it('refuses a cash confirmation on a non-cash payment', async () => {
      state.payment = harness.basePayment({ method: 'ONLINE' });

      const response = await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(400);

      expect(response.body.error.message).toContain('Only a cash payment');
    });

    it('keeps a visible history of every confirmation', async () => {
      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('CUSTOMER'))
        .send({})
        .expect(201);
      await api()
        .post(`/api/v1/professional/payments/${BOOKING_ID}/cash/confirm`)
        .set(as('PROFESSIONAL'))
        .send({})
        .expect(201);

      const response = await api()
        .get(`/api/v1/customer/payments/${BOOKING_ID}/history`)
        .set(as('CUSTOMER'))
        .expect(200);

      expect(response.body.data.attempts.length).toBeGreaterThanOrEqual(2);
      expect(response.body.data.cash.isSettled).toBe(true);
    });
  });

  describe('gateway settlement', () => {
    /** Builds a callback body, so the signature is computed over real bytes. */
    const callback = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        eventId: 'evt-1',
        gatewayTransactionId: 'sbx_abc',
        outcome: 'SUCCEEDED',
        amount: 1000,
        currency: 'INR',
        timestamp: new Date().toISOString(),
        ...overrides,
      });

    const send = (raw: string, signature: string) =>
      api()
        .post('/api/v1/payments/webhook')
        .set('x-helpzy-signature', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

    beforeEach(() => {
      state.booking = harness.baseBooking({ status: 'PAYMENT_PENDING' });
      state.payment = harness.basePayment({
        method: 'ONLINE',
        status: 'PROCESSING',
        gatewayTransactionId: 'sbx_abc',
        provider: 'sandbox',
      });
    });

    it('opens a checkout without settling anything', async () => {
      state.payment = null;
      const response = await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/checkout`)
        .set(as('CUSTOMER'))
        .send({ method: 'UPI' })
        .expect(201);

      // A checkout is not a payment.
      expect(response.body.data.verified).toBe(false);
      expect(response.body.data.gatewayTransactionId).toMatch(/^sbx_/);
      expect(state.payment!.status).toBe('PROCESSING');
      expect(state.payment!.gatewayVerified).toBe(false);
    });

    it('refuses a second checkout while one is live', async () => {
      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/checkout`)
        .set(as('CUSTOMER'))
        .send({ method: 'UPI' })
        .expect(409);
    });

    it('settles a payment on a correctly signed callback', async () => {
      const raw = callback();
      const response = await send(raw, harness.sign(raw)).expect(200);

      expect(response.body.data.applied).toBe(true);
      expect(state.payment!.status).toBe('PAID');
      // This is the only path that sets the verified flag.
      expect(state.payment!.gatewayVerified).toBe(true);
      expect(state.booking!.status).toBe('PAID');
    });

    it('ignores a callback with a bad signature', async () => {
      const raw = callback();
      await send(raw, 'not-the-right-signature').expect(503);

      // Nothing moved: an unverifiable callback is never trusted.
      expect(state.payment!.status).toBe('PROCESSING');
      expect(state.booking!.status).toBe('PAYMENT_PENDING');
    });

    it('ignores a callback with no signature at all', async () => {
      await api()
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(callback())
        .expect(400);
    });

    it('is idempotent for a retried callback', async () => {
      const raw = callback();
      const signature = harness.sign(raw);
      await send(raw, signature).expect(200);

      const paidMoves = harness.history.filter((entry) => entry.toStatus === 'PAID').length;
      const paidAttempts = harness.attempts.filter((entry) => entry.status === 'PAID').length;

      // The same event id again is a no-op, not a second payment.
      const retry = await send(raw, signature).expect(200);

      expect(retry.body.data.duplicate).toBe(true);
      expect(retry.body.data.applied).toBe(false);
      expect(harness.history.filter((entry) => entry.toStatus === 'PAID').length).toBe(paidMoves);
      expect(harness.attempts.filter((entry) => entry.status === 'PAID').length).toBe(paidAttempts);
    });

    it('reprocesses a callback whose first attempt failed', async () => {
      // The booking has moved on, so the settlement cannot apply - the
      // same race a real gateway retry hits when the booking was never
      // left waiting on payment.
      state.booking = harness.baseBooking({ status: 'CUSTOMER_CONFIRMED' });
      const raw = callback();
      const signature = harness.sign(raw);

      await send(raw, signature).expect(400);

      // The failed attempt must not consume the callback: nothing was
      // settled, so the event is not recorded either.
      expect(harness.webhookEvents.has('evt-1')).toBe(false);

      // The transaction rolled the payment back to what it was. The
      // doubles do not model rollback, so the test restores it by hand.
      state.payment!.status = 'PROCESSING';
      state.payment!.gatewayVerified = false;
      state.booking = harness.baseBooking({ status: 'PAYMENT_PENDING' });

      const retry = await send(raw, signature).expect(200);

      expect(retry.body.data.applied).toBe(true);
      expect(retry.body.data.duplicate).toBe(false);
      expect(state.payment!.status).toBe('PAID');
      expect(state.payment!.gatewayVerified).toBe(true);
      expect(state.booking!.status).toBe('PAID');
    });

    it('refuses a callback whose amount does not match the booking', async () => {
      const raw = callback({ amount: 1 });
      await send(raw, harness.sign(raw)).expect(200);

      // Proof of a different amount is not proof this booking was paid.
      expect(state.payment!.status).toBe('FAILED');
      expect(state.booking!.status).toBe('PAYMENT_PENDING');

      // A mismatch is a payment failure, so it is visible in the
      // attempt history and in the customer's notifications.
      expect(
        harness.attempts.some(
          (entry) =>
            entry.status === 'FAILED' &&
            entry.reference === 'evt-1' &&
            entry.note === 'Gateway callback reported a different amount than the booking.',
        ),
      ).toBe(true);
      expect(
        harness.notifications.some(
          (entry) => entry.type === 'PAYMENT_FAILED' && entry.userId === CUSTOMER_ID,
        ),
      ).toBe(true);
    });

    it('records a failed outcome without settling the booking', async () => {
      const raw = callback({ outcome: 'FAILED' });
      await send(raw, harness.sign(raw)).expect(200);

      expect(state.payment!.status).toBe('FAILED');
      expect(state.booking!.status).toBe('PAYMENT_PENDING');

      // A gateway-reported failure is the customer's to know about.
      expect(
        harness.notifications.some(
          (entry) => entry.type === 'PAYMENT_FAILED' && entry.userId === CUSTOMER_ID,
        ),
      ).toBe(true);
    });

    it('lets a customer retry after a failure', async () => {
      state.payment = harness.basePayment({ method: 'ONLINE', status: 'FAILED' });

      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/checkout`)
        .set(as('CUSTOMER'))
        .send({ method: 'CREDIT_CARD' })
        .expect(201);

      expect(state.payment!.status).toBe('PROCESSING');
      expect(state.payment!.gatewayMethod).toBe('CREDIT_CARD');
    });

    it('charges the price the booking agreed, not the listing price today', async () => {
      state.payment = null;
      // The listing has been repriced since the booking was made. The customer
      // agreed to the earlier figure, and that is what must be charged.
      state.booking = harness.baseBooking({
        status: 'PAYMENT_PENDING',
        priceAmount: { toNumber: () => 900 },
        currency: 'INR',
      });

      await api()
        .post(`/api/v1/customer/payments/${BOOKING_ID}/checkout`)
        .set(as('CUSTOMER'))
        .send({ method: 'UPI' })
        .expect(201);

      const charged = (state.payment!.amount as { toNumber: () => number }).toNumber();
      expect(charged).toBe(900);
      // Not 1000, which is what the seeded service price says.
      expect(charged).not.toBe(1000);
    });

    it('refuses a checkout when the gateway has nothing to sign with', async () => {
      /*
       * `isConfigured()` is false whenever the signing secret is empty. A checkout
       * opened in that state could never be settled, because every callback would
       * fail verification - so it is refused up front, where the customer can be
       * told to pay another way, rather than leaving them stuck at "processing".
       *
       * The secret is emptied on the live provider rather than the environment
       * variable, because the configuration object was read at boot.
       */
      state.payment = null;
      const gateway = harness.app.get(SandboxPaymentGateway, { strict: false }) as unknown as {
        config: { paymentWebhookSecret: string };
      };
      const original = gateway.config.paymentWebhookSecret;
      gateway.config.paymentWebhookSecret = '';

      try {
        await api()
          .post(`/api/v1/customer/payments/${BOOKING_ID}/checkout`)
          .set(as('CUSTOMER'))
          .send({ method: 'UPI' })
          .expect(400);
      } finally {
        gateway.config.paymentWebhookSecret = original;
      }
    });

    it('will not un-settle a paid payment when a late callback reports failure', async () => {
      // Gateways redeliver out of order. A `FAILED` callback arriving after the
      // `SUCCEEDED` one must not undo a completed payment, because the booking has
      // already moved to PAID and the money has been taken.
      const settled = callback();
      await send(settled, harness.sign(settled)).expect(200);
      expect(state.payment!.status).toBe('PAID');
      expect(state.booking!.status).toBe('PAID');

      const late = callback({ eventId: 'evt-late', outcome: 'FAILED' });
      const response = await send(late, harness.sign(late)).expect(200);

      expect(response.body.data.applied).toBe(false);
      expect(state.payment!.status).toBe('PAID');
      expect(state.booking!.status).toBe('PAID');
    });

    it('will not un-settle a paid payment when a late callback reports another amount', async () => {
      const settled = callback();
      await send(settled, harness.sign(settled)).expect(200);

      const late = callback({ eventId: 'evt-late-amount', amount: 5 });
      const response = await send(late, harness.sign(late)).expect(200);

      expect(response.body.data.applied).toBe(false);
      expect(state.payment!.status).toBe('PAID');
      expect(state.booking!.status).toBe('PAID');
    });

    it('will not fail a refunded payment when a late callback reports failure', async () => {
      /*
       * The shape this has to survive: the payment settled, HELPZY refunded it and
       * closed the booking, and the gateway then redelivers an out-of-order failure
       * for the same transaction. A write that only guarded against `PAID` matched
       * the refunded row here, so the refund was overwritten with `FAILED` and the
       * customer was told their money was lost when it had been returned to them.
       */
      const settled = callback();
      await send(settled, harness.sign(settled)).expect(200);

      // The admin refund: the payment returns to REFUNDED and the booking closes.
      state.payment!.status = 'REFUNDED';
      state.payment!.failureReason = 'Refund by HELPZY: the work was never carried out.';
      state.booking!.status = 'CLOSED';
      harness.notifications.length = 0;

      const late = callback({ eventId: 'evt-after-refund', outcome: 'FAILED' });
      const response = await send(late, harness.sign(late)).expect(200);

      expect(response.body.data.applied).toBe(false);
      expect(state.payment!.status).toBe('REFUNDED');
      expect(state.payment!.failureReason).toContain('Refund by HELPZY');
      expect(state.booking!.status).toBe('CLOSED');
      expect(
        harness.notifications.some(
          (entry) => entry.type === 'PAYMENT_FAILED' && entry.userId === CUSTOMER_ID,
        ),
      ).toBe(false);
      expect(harness.attempts.some((entry) => entry.status === 'FAILED')).toBe(false);
    });

    it('will not re-settle a refunded payment when a success callback arrives late', async () => {
      state.payment!.status = 'REFUNDED';
      state.booking!.status = 'CLOSED';

      const late = callback({ eventId: 'evt-refund-then-success' });
      const response = await send(late, harness.sign(late)).expect(200);

      expect(response.body.data.applied).toBe(false);
      expect(state.payment!.status).toBe('REFUNDED');
      // The refunded booking stays closed: settling it again would reopen work that
      // HELPZY already returned the money for.
      expect(state.booking!.status).toBe('CLOSED');
      expect(harness.notifications.some((entry) => entry.type === 'PAYMENT_PAID')).toBe(false);
    });

    it('will not move a payment held by a dispute', async () => {
      // The payment status a dispute holds money in. It is not the gateway's to
      // rewrite, and a callback that did so would settle a payment an admin has not
      // looked at yet.
      state.payment!.status = 'DISPUTED';

      for (const overrides of [
        { eventId: 'evt-disputed-success' },
        { eventId: 'evt-disputed-failed', outcome: 'FAILED' },
        { eventId: 'evt-disputed-amount', amount: 5 },
      ]) {
        const raw = callback(overrides);
        const response = await send(raw, harness.sign(raw)).expect(200);

        expect(response.body.data.applied).toBe(false);
        expect(state.payment!.status).toBe('DISPUTED');
      }
    });

    it('tells the customer nothing when a callback settles nothing', async () => {
      /*
       * Another callback settled the payment between this one's read and its write,
       * which the guarded claim reports as matching nothing. Nothing was settled, so
       * the customer must not be told their money was taken, and the event is not
       * recorded either - a retry has to stay reprocessable rather than look like a
       * callback that has already been applied.
       */
      harness.modelMethod('payment', 'updateMany').mockResolvedValueOnce({ count: 0 });

      const raw = callback();
      const response = await send(raw, harness.sign(raw)).expect(200);

      expect(response.body.data.applied).toBe(false);
      expect(harness.notifications.some((entry) => entry.type === 'PAYMENT_PAID')).toBe(false);
      expect(harness.webhookEvents.has('evt-1')).toBe(false);
      expect(harness.history.some((entry) => entry.toStatus === 'PAID')).toBe(false);
    });
  });

  describe('recording a direct payment', () => {
    /** The professional's receipt, which carries a `received` flag by schema. */
    const record = () =>
      api()
        .post(`/api/v1/professional/payments/${BOOKING_ID}/direct`)
        .set(as('PROFESSIONAL'))
        .send({ received: true });

    beforeEach(() => {
      state.booking = harness.baseBooking({ status: 'PAYMENT_PENDING' });
      state.payment = harness.basePayment({ method: 'DIRECT', status: 'PENDING' });
    });

    it('records the receipt and settles the booking', async () => {
      await record().expect(201);

      expect(state.payment!.status).toBe('PAID');
      expect(state.booking!.status).toBe('PAID');
    });

    it('treats a repeated receipt as a no-op', async () => {
      await record().expect(201);
      const paidAttempts = harness.attempts.filter((entry) => entry.status === 'PAID').length;

      await record().expect(201);

      expect(harness.attempts.filter((entry) => entry.status === 'PAID').length).toBe(paidAttempts);
      expect(state.payment!.status).toBe('PAID');
    });

    it('will not overwrite a refunded payment', async () => {
      // The same late-write hazard as a redelivered callback, on a path with no
      // gateway to make it late: a refunded payment is money already returned, and
      // re-stamping it as received erases the refund the customer is relying on.
      state.payment!.status = 'REFUNDED';
      state.payment!.failureReason = 'Refund by HELPZY: the job was cancelled.';
      state.booking!.status = 'CLOSED';

      const response = await record();

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
      expect(state.payment!.status).toBe('REFUNDED');
      expect(harness.attempts.filter((entry) => entry.status === 'PAID')).toHaveLength(0);
    });

    it('will not overwrite a payment held by a dispute', async () => {
      state.payment!.status = 'DISPUTED';

      const response = await record();

      expect(response.status).toBe(409);
      expect(state.payment!.status).toBe('DISPUTED');
      expect(harness.attempts.filter((entry) => entry.status === 'PAID')).toHaveLength(0);
    });

    it('will not overwrite a failed payment', async () => {
      // Recovered by starting a fresh payment, which returns the row to PENDING -
      // never by re-confirming the one that failed.
      state.payment!.status = 'FAILED';

      const response = await record();

      expect(response.status).toBe(409);
      expect(state.payment!.status).toBe('FAILED');
      expect(harness.attempts.filter((entry) => entry.status === 'PAID')).toHaveLength(0);
    });

    it('still refuses a payment that is not a direct one', async () => {
      state.payment = harness.basePayment({ method: 'ONLINE', status: 'PENDING' });

      const response = await record();

      expect(response.status).toBe(400);
      expect(state.payment!.status).toBe('PENDING');
    });
  });

  describe('verification documents', () => {
    /** A minimal valid PDF: the signature check only reads the header. */
    const pdf = () => Buffer.from('%PDF-1.4\n%HELPZY-TEST\n%%EOF').toString('base64');

    const submit = (type: string) =>
      api()
        .post('/api/v1/professional/verification-documents')
        .set(as('PROFESSIONAL'))
        .send({ type, contentType: 'application/pdf', data: pdf() });

    const review = (documentId: string, body: Record<string, unknown>) =>
      api()
        .post(`/api/v1/admin/verification-documents/${documentId}/review`)
        .set(as('ADMIN'))
        .send(body);

    it('accepts a well-formed document and leaves the professional unverified', async () => {
      const response = await submit('AADHAAR').expect(201);

      expect(response.body.data.status).toBe('PENDING');
      // Uploading must never grant a badge by itself.
      expect(harness.model('professionalProfile').update).not.toHaveBeenCalled();
    });

    it('rejects a file whose bytes do not match its declared type', async () => {
      const response = await api()
        .post('/api/v1/professional/verification-documents')
        .set(as('PROFESSIONAL'))
        .send({
          type: 'AADHAAR',
          contentType: 'application/pdf',
          // Claims to be a PDF, but the header says otherwise.
          data: Buffer.from('this is definitely not a pdf').toString('base64'),
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(harness.model('verificationDocument').create).not.toHaveBeenCalled();
    });

    it('reports what is still outstanding', async () => {
      const response = await api()
        .get('/api/v1/professional/verification-documents')
        .set(as('PROFESSIONAL'))
        .expect(200);

      expect(response.body.data.requiredTypes).toEqual(['AADHAAR', 'PAN']);
      // Nothing submitted yet, so both are outstanding.
      expect(response.body.data.outstandingTypes).toEqual(['AADHAAR', 'PAN']);
    });

    it('clears a type once a document is submitted', async () => {
      await submit('AADHAAR').expect(201);

      const response = await api()
        .get('/api/v1/professional/verification-documents')
        .set(as('PROFESSIONAL'))
        .expect(200);

      expect(response.body.data.outstandingTypes).toEqual(['PAN']);
    });

    it('lets an admin approve, with an audit record', async () => {
      await submit('AADHAAR').expect(201);
      const documentId = String(state.documents[0]?.id ?? '');

      const response = await review(documentId, { decision: 'APPROVED' }).expect(201);

      expect(response.body.data.status).toBe('APPROVED');
      expect(harness.auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'VERIFICATION_DOCUMENT_REVIEWED',
            entityType: 'VERIFICATION_DOCUMENT',
            entityId: documentId,
          }),
        ]),
      );
    });

    it('requires a reason when rejecting', async () => {
      await submit('AADHAAR').expect(201);
      const documentId = String(state.documents[0]?.id ?? '');

      const response = await review(documentId, { decision: 'REJECTED' }).expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('stores the rejection reason and puts the type back on the list', async () => {
      await submit('AADHAAR').expect(201);
      const documentId = String(state.documents[0]?.id ?? '');
      await review(documentId, { decision: 'REJECTED', note: 'The image is cut off.' }).expect(201);

      const response = await api()
        .get('/api/v1/professional/verification-documents')
        .set(as('PROFESSIONAL'))
        .expect(200);

      expect(response.body.data.documents[0].rejectionReason).toBe('The image is cut off.');
      expect(response.body.data.outstandingTypes).toContain('AADHAAR');
    });

    it('refuses to review the same document twice', async () => {
      await submit('AADHAAR').expect(201);
      const documentId = String(state.documents[0]?.id ?? '');
      await review(documentId, { decision: 'APPROVED' }).expect(201);

      await review(documentId, { decision: 'REJECTED', note: 'Changed my mind.' }).expect(400);
    });

    it('keeps the previous submission when a professional resubmits', async () => {
      await submit('AADHAAR').expect(201);
      await submit('AADHAAR').expect(201);

      const response = await api()
        .get('/api/v1/professional/verification-documents')
        .set(as('PROFESSIONAL'))
        .expect(200);

      // History is append-only, so both attempts remain visible.
      expect(response.body.data.documents).toHaveLength(2);
    });

    it('keeps the review queue behind the admin role', async () => {
      await api()
        .get('/api/v1/admin/verification-documents/pending')
        .set(as('CUSTOMER'))
        .expect(403);
    });

    it('does not let a customer upload a document', async () => {
      await api()
        .post('/api/v1/professional/verification-documents')
        .set(as('CUSTOMER'))
        .send({ type: 'AADHAAR', contentType: 'application/pdf', data: pdf() })
        .expect(403);
    });
  });
});
