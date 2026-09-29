import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/ui';

const serviceCategories = [
  {
    name: 'Plumbing',
    description: 'Repairs, installation & maintenance',
    icon: 'P',
    accent: 'bg-sky-100',
    accentText: 'text-sky-700',
  },
  {
    name: 'Electrical',
    description: 'Wiring, repairs & installations',
    icon: 'E',
    accent: 'bg-amber-100',
    accentText: 'text-amber-700',
  },
  {
    name: 'AC Repair',
    description: 'AC service, repair & maintenance',
    icon: 'AC',
    accent: 'bg-cyan-100',
    accentText: 'text-cyan-700',
  },
  {
    name: 'Cleaning',
    description: 'Home & deep cleaning services',
    icon: 'C',
    accent: 'bg-emerald-100',
    accentText: 'text-emerald-700',
  },
  {
    name: 'Carpentry',
    description: 'Furniture, fittings & woodwork',
    icon: 'W',
    accent: 'bg-violet-100',
    accentText: 'text-violet-700',
  },
  {
    name: 'Painting',
    description: 'Interior & exterior painting',
    icon: 'PA',
    accent: 'bg-rose-100',
    accentText: 'text-rose-700',
  },
];

const steps = [
  {
    number: '01',
    title: 'Choose a service',
    description: 'Tell us what you need.',
  },
  {
    number: '02',
    title: 'Find a professional',
    description: 'Browse local professionals who provide the service.',
  },
  {
    number: '03',
    title: 'Book a convenient time',
    description: 'Choose a date, time and service location.',
  },
  {
    number: '04',
    title: 'Get the job done',
    description: 'Track the booking and complete the service.',
  },
];

const features = [
  {
    title: 'Local Professionals',
    description: 'Find service providers around your area.',
  },
  {
    title: 'Easy Booking',
    description: 'Request a service with your preferred date and time.',
  },
  {
    title: 'Transparent Service History',
    description: 'Keep your bookings, payments and service history in one place.',
  },
  {
    title: 'Secure Communication',
    description: 'Stay connected through your HELPZY booking.',
  },
];

export function HelpzyLandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionPositions = useRef<Record<string, number>>({});

  const scrollToSection = (target: string) => {
    const position = sectionPositions.current[target];
    if (position !== undefined) {
      scrollRef.current?.scrollTo({ y: Math.max(position - 20, 0), animated: true });
    }
  };

  const handleNavAction = (target: string, message?: string) => {
    if (target === 'login') {
      router.push('/login');
      setMobileMenuOpen(false);
      return;
    }

    if (target === 'register') {
      router.push('/register');
      setMobileMenuOpen(false);
      return;
    }

    if (message) {
      setNotice(message);
    }
    if (target) {
      scrollToSection(target);
    }
    setMobileMenuOpen(false);
  };

  const handleSearch = () => {
    if (!searchValue.trim()) {
      setNotice('Service search is opening the local service options below.');
      scrollToSection('services');
      return;
    }
    setNotice('Service search will be available in the next phase.');
    scrollToSection('services');
  };

  const handleSectionLayout = (target: string, event: LayoutChangeEvent) => {
    sectionPositions.current[target] = event.nativeEvent.layout.y;
  };

  return (
    <View className="flex-1 bg-slate-50">
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View className="bg-white" onLayout={(event) => handleSectionLayout('home', event)}>
          <View className="mx-auto w-full max-w-6xl px-4 pb-4 pt-4 sm:px-6 lg:px-8">
            <Header
              onNavPress={handleNavAction}
              onMenuToggle={() => setMobileMenuOpen((value) => !value)}
              mobileMenuOpen={mobileMenuOpen}
            />
          </View>
        </View>

        {notice ? (
          <View className="mx-auto w-full max-w-6xl px-4 pt-2 sm:px-6 lg:px-8">
            <View className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
              <Text className="text-sm font-medium text-brand-800">{notice}</Text>
            </View>
          </View>
        ) : null}

        <View
          className="mx-auto w-full max-w-6xl px-4 pb-8 pt-6 sm:px-6 lg:px-8"
          onLayout={(event) => handleSectionLayout('hero', event)}
        >
          <HeroSection
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSearch={handleSearch}
            onPrimaryAction={() => router.push('/login')}
            onSecondaryAction={() => router.push('/register')}
          />
        </View>

        <View
          className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
          onLayout={(event) => handleSectionLayout('services', event)}
        >
          <PopularServicesSection
            onServicePress={() =>
              handleNavAction('how', 'Service discovery flows are coming next.')
            }
          />
        </View>

        <View className="bg-white" onLayout={(event) => handleSectionLayout('how', event)}>
          <View className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
            <HowItWorksSection />
          </View>
        </View>

        <View className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <FeatureSection />
        </View>

        <View
          className="bg-brand-50"
          onLayout={(event) => handleSectionLayout('professionals', event)}
        >
          <View className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
            <ProfessionalCTA onAction={() => router.push('/register')} />
          </View>
        </View>

        <View className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <FinalCTA
            onPrimaryAction={() => router.push('/login')}
            onSecondaryAction={() => router.push('/register')}
          />
        </View>

        <Footer />
      </ScrollView>
    </View>
  );
}

function Header({
  onNavPress,
  onMenuToggle,
  mobileMenuOpen,
}: {
  onNavPress: (target: string, message?: string) => void;
  onMenuToggle: () => void;
  mobileMenuOpen: boolean;
}) {
  const desktopNav: Array<{ label: string; target: string; message?: string }> = [
    { label: 'Home', target: 'hero' },
    { label: 'Services', target: 'services' },
    { label: 'How It Works', target: 'how' },
    { label: 'For Professionals', target: 'professionals' },
  ];

  const mobileNav: Array<{ label: string; target: string; message?: string }> = [
    ...desktopNav,
    { label: 'Log in', target: 'login' },
    {
      label: 'Get Started',
      target: 'register',
    },
  ];

  return (
    <View className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm shadow-slate-200/70">
      <View className="flex-row items-center justify-between gap-4">
        <Pressable accessibilityRole="button" onPress={() => onNavPress('hero')}>
          <Text className="text-2xl font-extrabold tracking-tight text-slate-900">HELPZY</Text>
        </Pressable>

        <View className="hidden flex-row items-center gap-6 md:flex">
          {desktopNav.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => onNavPress(item.target)}
            >
              <Text className="text-sm font-medium text-slate-600">{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View className="hidden items-center gap-3 md:flex">
          <Pressable accessibilityRole="button" onPress={() => onNavPress('login')}>
            <Text className="text-sm font-medium text-slate-700">Log in</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onNavPress('register')}
            className="rounded-xl bg-brand-600 px-4 py-2.5"
          >
            <Text className="text-sm font-semibold text-white">Get Started</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Toggle navigation menu"
          onPress={onMenuToggle}
          className="md:hidden"
        >
          <View className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
            <Text className="text-lg font-bold text-slate-700">☰</Text>
          </View>
        </Pressable>
      </View>

      {mobileMenuOpen ? (
        <View className="mt-4 space-y-2 md:hidden">
          {mobileNav.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => onNavPress(item.target, item.message)}
              className="rounded-xl border border-slate-200 px-3 py-2.5"
            >
              <Text className="text-sm font-medium text-slate-700">{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HeroSection({
  searchValue,
  onSearchChange,
  onSearch,
  onPrimaryAction,
  onSecondaryAction,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
}) {
  return (
    <View className="mt-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6 lg:p-8">
      <View className="flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <View className="flex-1">
          <View className="mb-4 self-start rounded-full bg-brand-50 px-3 py-1">
            <Text className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
              Trusted local services
            </Text>
          </View>
          <Text className="max-w-xl text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl">
            Find the Right Service,
            {'\n'}Right Around You.
          </Text>
          <Text className="mt-4 max-w-xl text-base text-slate-600 sm:text-lg">
            Connect with trusted local professionals for everyday services, repairs, and home needs.
          </Text>

          <View className="mt-6 flex-row flex-wrap items-center gap-3">
            <PrimaryButton label="Find a Service" onPress={onPrimaryAction} />
            <Pressable
              accessibilityRole="button"
              onPress={onSecondaryAction}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-5 py-3"
            >
              <Text className="text-base font-semibold text-slate-800">Join as a Professional</Text>
            </Pressable>
          </View>

          <View className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <View className="flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Text className="text-lg text-slate-400">⌕</Text>
              <TextInput
                accessibilityLabel="Search for a service"
                value={searchValue}
                onChangeText={onSearchChange}
                placeholder="What service do you need?"
                placeholderTextColor="#64748b"
                className="flex-1 text-base text-slate-800"
              />
            </View>
            <View className="mt-3 flex-row gap-3">
              <Pressable
                accessibilityRole="button"
                onPress={onSearch}
                className="flex-1 rounded-xl bg-brand-600 px-4 py-3"
              >
                <Text className="text-center text-base font-semibold text-white">Search</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View className="w-full max-w-md self-stretch md:w-[42%]">
          <View className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-700 p-5 shadow-lg shadow-slate-200/80">
            <Text className="text-sm font-medium text-slate-200">Need an electrician?</Text>
            <Text className="mt-2 text-2xl font-bold text-white">
              Available professionals nearby
            </Text>
            <View className="mt-5 rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-slate-200">Quick availability</Text>
                <Text className="text-sm font-semibold text-amber-300">4.8 ★</Text>
              </View>
              <View className="mt-4 rounded-2xl bg-white px-4 py-3">
                <Text className="text-base font-semibold text-slate-900">Electrical repair</Text>
                <Text className="mt-1 text-sm text-slate-600">Today · 6:30 PM</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={onPrimaryAction}
                className="mt-4 rounded-xl bg-brand-500 px-4 py-3"
              >
                <Text className="text-center text-base font-semibold text-white">
                  Book a service →
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function PopularServicesSection({ onServicePress }: { onServicePress: () => void }) {
  return (
    <View>
      <View className="mb-6">
        <Text className="text-3xl font-bold tracking-tight text-slate-900">Popular Services</Text>
        <Text className="mt-2 text-base text-slate-600">
          Get help from local professionals for everyday needs.
        </Text>
      </View>

      <View className="flex-row flex-wrap justify-between gap-4">
        {serviceCategories.map((service) => (
          <Pressable
            key={service.name}
            accessibilityRole="button"
            accessibilityLabel={`View ${service.name}`}
            onPress={onServicePress}
            className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.75rem)]"
          >
            <View className="flex-row items-center justify-between">
              <View
                className={`h-12 w-12 items-center justify-center rounded-2xl ${service.accent}`}
              >
                <Text className={`text-lg font-bold ${service.accentText}`}>{service.icon}</Text>
              </View>
              <Text className="text-xl text-slate-400">→</Text>
            </View>
            <Text className="mt-4 text-xl font-semibold text-slate-900">{service.name}</Text>
            <Text className="mt-2 text-sm leading-6 text-slate-600">{service.description}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function HowItWorksSection() {
  return (
    <View>
      <Text className="text-3xl font-bold tracking-tight text-slate-900">How HELPZY Works</Text>
      <View className="mt-6 flex-row flex-wrap gap-4">
        {steps.map((step) => (
          <View
            key={step.number}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:w-[calc(50%-0.5rem)] xl:w-[calc(25%-0.75rem)]"
          >
            <Text className="text-sm font-semibold uppercase tracking-[0.12em] text-brand-700">
              {step.number}
            </Text>
            <Text className="mt-3 text-xl font-semibold text-slate-900">{step.title}</Text>
            <Text className="mt-2 text-sm leading-6 text-slate-600">{step.description}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FeatureSection() {
  return (
    <View>
      <Text className="text-3xl font-bold tracking-tight text-slate-900">
        Everything You Need for Local Services
      </Text>
      <View className="mt-6 flex-row flex-wrap gap-4">
        {features.map((feature) => (
          <View
            key={feature.title}
            className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50 sm:w-[calc(50%-0.5rem)] xl:w-[calc(25%-0.75rem)]"
          >
            <View className="mb-4 h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
              <Text className="text-lg font-bold text-brand-700">•</Text>
            </View>
            <Text className="text-xl font-semibold text-slate-900">{feature.title}</Text>
            <Text className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ProfessionalCTA({ onAction }: { onAction: () => void }) {
  return (
    <View className="rounded-[28px] border border-brand-100 bg-white p-5 shadow-sm shadow-brand-100/70 sm:p-6 lg:p-8">
      <View className="flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <View className="max-w-2xl">
          <Text className="text-3xl font-bold tracking-tight text-slate-900">
            Are You a Service Professional?
          </Text>
          <Text className="mt-3 text-base text-slate-600">
            Grow your local business by connecting with customers who need your services.
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-3">
            {[
              'Receive local service requests',
              'Manage bookings',
              'Build your professional profile',
              'Track completed services',
            ].map((item) => (
              <View
                key={item}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5"
              >
                <Text className="text-xs font-medium text-slate-700">{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          className="min-h-[48px] rounded-xl bg-brand-600 px-5 py-3 shadow-sm shadow-brand-200"
        >
          <Text className="text-base font-semibold text-white">Join as a Professional</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FinalCTA({
  onPrimaryAction,
  onSecondaryAction,
}: {
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
}) {
  return (
    <View className="rounded-[28px] border border-slate-200 bg-slate-900 p-6 sm:p-8">
      <Text className="text-3xl font-bold tracking-tight text-white">Need a service?</Text>
      <Text className="mt-2 text-xl text-slate-200">
        HELPZY can help you find the right professional.
      </Text>
      <View className="mt-6 flex-row flex-wrap gap-3">
        <PrimaryButton label="Find a Service" onPress={onPrimaryAction} />
        <Pressable
          accessibilityRole="button"
          onPress={onSecondaryAction}
          className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-800 px-5 py-3"
        >
          <Text className="text-base font-semibold text-white">Join as a Professional</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Footer() {
  return (
    <View className="border-t border-slate-200 bg-white">
      <View className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <View className="flex-col gap-8 md:flex-row md:justify-between">
          <View className="max-w-md">
            <Text className="text-2xl font-extrabold tracking-tight text-slate-900">HELPZY</Text>
            <Text className="mt-3 text-base text-slate-600">
              Find the Right Service, Right Around You
            </Text>
          </View>

          <View className="flex-row flex-wrap gap-8">
            <View>
              <Text className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                Customer
              </Text>
              <Text className="text-sm text-slate-600">Find a Service</Text>
              <Text className="mt-2 text-sm text-slate-600">How It Works</Text>
            </View>
            <View>
              <Text className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                Professional
              </Text>
              <Text className="text-sm text-slate-600">Join as a Professional</Text>
            </View>
            <View>
              <Text className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                Company
              </Text>
              <Text className="text-sm text-slate-600">About</Text>
              <Text className="mt-2 text-sm text-slate-600">Contact</Text>
            </View>
            <View>
              <Text className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                Legal
              </Text>
              <Text className="text-sm text-slate-600">Privacy</Text>
              <Text className="mt-2 text-sm text-slate-600">Terms</Text>
            </View>
          </View>
        </View>

        <View className="mt-8 border-t border-slate-200 pt-5">
          <Text className="text-sm text-slate-500">© 2026 HELPZY</Text>
        </View>
      </View>
    </View>
  );
}
