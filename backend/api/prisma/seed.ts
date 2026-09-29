/**
 * Development seed.
 *
 * Requirements:
 *  - Idempotent: running it twice leaves exactly the same rows, so it is safe
 *    to call after every `db:reset`.
 *  - No real personal data, no external services, no network calls.
 *  - Every lookup is by a natural key (email, slug, reference) so re-running
 *    updates rather than duplicating.
 *
 * Passwords are all `Helpzy@123` (documented in docs/testing.md); the hashing
 * helper is a plain SHA-256 stand-in that the auth phase replaces with argon2.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'Helpzy@123';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

const CATEGORIES = [
  {
    slug: 'home-services',
    name: 'Home Services',
    description: 'Cleaning, repairs, plumbing, electrical.',
    sortOrder: 10,
  },
  {
    slug: 'beauty-wellness',
    name: 'Beauty & Wellness',
    description: 'Salons, spa, massage, grooming.',
    sortOrder: 20,
  },
  {
    slug: 'education',
    name: 'Education & Tutoring',
    description: 'Tuition, coaching, skill classes.',
    sortOrder: 30,
  },
  {
    slug: 'health-fitness',
    name: 'Health & Fitness',
    description: 'Trainers, physio, nutritionists.',
    sortOrder: 40,
  },
  {
    slug: 'automotive',
    name: 'Automotive',
    description: 'Car care, servicing, roadside help.',
    sortOrder: 50,
  },
  {
    slug: 'events',
    name: 'Events',
    description: 'Catering, decoration, event staffing.',
    sortOrder: 60,
  },
] as const;

const USERS = [
  {
    email: 'admin@helpzy.test',
    fullName: 'Aditi Rao',
    phone: '+919800000001',
    role: 'ADMIN' as const,
  },
  {
    email: 'customer@helpzy.test',
    fullName: 'Rahul Verma',
    phone: '+919800000002',
    role: 'CUSTOMER' as const,
  },
  {
    email: 'meera@helpzy.test',
    fullName: 'Meera Iyer',
    phone: '+919800000003',
    role: 'PROFESSIONAL' as const,
    businessName: 'Meera Home Care',
    bio: 'Deep cleaning and appliance servicing since 2016.',
    serviceArea: 'Bengaluru',
    verification: 'VERIFIED' as const,
  },
  {
    email: 'sameer@helpzy.test',
    fullName: 'Sameer Khan',
    phone: '+919800000004',
    role: 'PROFESSIONAL' as const,
    businessName: 'Sameer Fitness Studio',
    bio: 'Personal training and injury rehabilitation.',
    serviceArea: 'Bengaluru',
    verification: 'PENDING' as const,
  },
];

const SERVICES = [
  {
    ownerEmail: 'meera@helpzy.test',
    categorySlug: 'home-services',
    slug: 'full-home-deep-clean',
    title: 'Full home deep clean',
    summary: 'Kitchen, bathrooms, bedrooms and living room.',
    description:
      'A four-hour deep clean covering kitchen, bathrooms, bedrooms and living room, including appliance interiors and window tracks.',
    basePrice: '2499.00',
    durationMinutes: 240,
  },
  {
    ownerEmail: 'meera@helpzy.test',
    categorySlug: 'home-services',
    slug: 'ac-servicing',
    title: 'AC servicing',
    summary: 'Split and window AC service with gas check.',
    description:
      'Standard servicing for split and window air conditioners, including coil cleaning, filter replacement and a gas level check.',
    basePrice: '899.00',
    durationMinutes: 90,
  },
  {
    ownerEmail: 'sameer@helpzy.test',
    categorySlug: 'health-fitness',
    slug: 'personal-training-session',
    title: 'Personal training session',
    summary: 'One hour of one-to-one coaching.',
    description:
      'A one-hour one-to-one session covering strength, mobility and conditioning, with a written plan after the first visit.',
    basePrice: '1200.00',
    durationMinutes: 60,
  },
];

async function seedUsers(): Promise<void> {
  for (const entry of USERS) {
    const data = {
      fullName: entry.fullName,
      phone: entry.phone,
      role: entry.role,
      status: 'ACTIVE' as const,
      passwordHash: hash(SEED_PASSWORD),
    };

    const user = await prisma.user.upsert({
      where: { email: entry.email },
      update: data,
      create: { email: entry.email, ...data },
    });

    if (entry.role !== 'PROFESSIONAL') continue;

    await prisma.professionalProfile.upsert({
      where: { userId: user.id },
      update: {
        businessName: entry.businessName,
        bio: entry.bio,
        serviceArea: entry.serviceArea,
        verification: entry.verification,
        verifiedAt: entry.verification === 'VERIFIED' ? new Date() : null,
      },
      create: {
        userId: user.id,
        businessName: entry.businessName,
        bio: entry.bio,
        serviceArea: entry.serviceArea,
        verification: entry.verification,
        verifiedAt: entry.verification === 'VERIFIED' ? new Date() : null,
      },
    });
  }
}

async function seedCategories(): Promise<void> {
  for (const category of CATEGORIES) {
    await prisma.serviceCategory.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
      },
      create: { ...category },
    });
  }
}

async function seedServices(): Promise<void> {
  for (const service of SERVICES) {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: service.ownerEmail } });
    const category = await prisma.serviceCategory.findUniqueOrThrow({
      where: { slug: service.categorySlug },
    });

    const data = {
      title: service.title,
      summary: service.summary,
      description: service.description,
      basePrice: new Prisma.Decimal(service.basePrice),
      durationMinutes: service.durationMinutes,
      isActive: true,
    };

    await prisma.service.upsert({
      where: { slug: service.slug },
      update: { ...data, ownerId: owner.id, categoryId: category.id },
      create: { slug: service.slug, ...data, ownerId: owner.id, categoryId: category.id },
    });
  }
}

async function seedBooking(): Promise<void> {
  const reference = 'HZ-DEMO-0001';
  const existing = await prisma.booking.findUnique({ where: { reference } });
  if (existing) return;

  const customer = await prisma.user.findUniqueOrThrow({
    where: { email: 'customer@helpzy.test' },
  });
  const professional = await prisma.user.findUniqueOrThrow({
    where: { email: 'meera@helpzy.test' },
  });
  const profile = await prisma.professionalProfile.findUniqueOrThrow({
    where: { userId: professional.id },
  });
  const service = await prisma.service.findUniqueOrThrow({
    where: { slug: 'full-home-deep-clean' },
  });

  const address = await prisma.address.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      userId: customer.id,
      label: 'Home',
      type: 'HOME',
      line1: '221B Baker Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      isDefault: true,
    },
  });

  const scheduledStart = new Date('2026-10-05T09:30:00.000Z');
  const scheduledEnd = new Date(scheduledStart.getTime() + 240 * 60 * 1000);

  const booking = await prisma.booking.upsert({
    where: { reference },
    update: {},
    create: {
      reference,
      customerId: customer.id,
      professionalId: profile.id,
      serviceId: service.id,
      addressId: address.id,
      status: 'REQUESTED',
      scheduledStart,
      scheduledEnd,
      priceAmount: new Prisma.Decimal('2499.00'),
      customerNote: 'Please call before arriving.',
    },
  });

  await prisma.payment.upsert({
    where: { bookingId: booking.id },
    update: {},
    create: {
      bookingId: booking.id,
      amount: new Prisma.Decimal('2499.00'),
      method: 'ONLINE',
      status: 'PENDING',
    },
  });
}

async function main(): Promise<void> {
  await seedUsers();
  await seedCategories();
  await seedServices();
  await seedBooking();

  const [users, professionals, categories, services, bookings, payments] = await Promise.all([
    prisma.user.count(),
    prisma.professionalProfile.count(),
    prisma.serviceCategory.count(),
    prisma.service.count(),
    prisma.booking.count(),
    prisma.payment.count(),
  ]);

  console.log(
    `Seed complete: ${users} users, ${professionals} professionals, ${categories} categories, ` +
      `${services} services, ${bookings} bookings, ${payments} payments.`,
  );
  console.log(`All seeded accounts use the password ${SEED_PASSWORD}.`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
