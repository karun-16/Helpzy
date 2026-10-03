import { AuditEntityType } from '@prisma/client';

import { AUDIT_ENTITY_TYPES } from './audit.controller';

/**
 * The admin audit screen filters by entity type, so the controller accepts only
 * the values it lists. If the schema gains an entity type that the list does not
 * include, services can still write audit rows for it while the filter rejects
 * the value - making that history unreachable to an admin.
 */
describe('AUDIT_ENTITY_TYPES', () => {
  const schemaValues = Object.values(AuditEntityType);

  it('accepts every entity type the schema defines', () => {
    expect([...AUDIT_ENTITY_TYPES].sort()).toEqual([...schemaValues].sort());
  });

  it('has no duplicate entries', () => {
    expect(new Set(AUDIT_ENTITY_TYPES).size).toBe(AUDIT_ENTITY_TYPES.length);
  });
});
