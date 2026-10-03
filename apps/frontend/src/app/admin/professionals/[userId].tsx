import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { AdminProfessionalDetailScreen } from '@/components/admin-professional-detail-screen';

export default function AdminProfessionalDetailRoute() {
  return (
    <AuthenticatedRoleScreen role="ADMIN">
      <AdminProfessionalDetailScreen />
    </AuthenticatedRoleScreen>
  );
}
