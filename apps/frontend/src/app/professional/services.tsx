import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { ProfessionalServicesScreen } from '@/components/professional-services-screen';

export default function ProfessionalServicesRoute() {
  return (
    <AuthenticatedRoleScreen role="PROFESSIONAL">
      <ProfessionalServicesScreen />
    </AuthenticatedRoleScreen>
  );
}
