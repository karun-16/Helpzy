import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { CustomerAddressesScreen } from '@/components/customer-addresses-screen';

export default function CustomerAddressesRoute() {
  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <CustomerAddressesScreen />
    </AuthenticatedRoleScreen>
  );
}
