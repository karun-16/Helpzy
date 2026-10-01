import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { ProfessionalMyJobsScreen } from '@/components/professional-my-jobs-screen';

export default function ProfessionalMyJobsRoute() {
  return (
    <AuthenticatedRoleScreen role="PROFESSIONAL">
      <ProfessionalMyJobsScreen />
    </AuthenticatedRoleScreen>
  );
}
