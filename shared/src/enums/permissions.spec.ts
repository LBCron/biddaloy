import { describe, expect, it } from 'vitest';

import { Permission, ROLE_PERMISSIONS, roleHasPermission } from './permissions';
import { UserRole } from './index';

describe('bulk-upload role grants [8.11.8]', () => {
  /**
   * `POST /students/bulk-upload` is declared
   * `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` in
   * `server/src/modules/students/students.controller.ts`. The frontend gates
   * the import page and its entry button on `STUDENT_BULK_UPLOAD`, so this
   * list has to agree with that decorator: a role that can call the endpoint
   * but cannot see the button experiences a missing feature, not a refusal.
   */
  const ROLES_ALLOWED_BY_THE_SERVER = [
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
  ] as const;

  for (const role of ROLES_ALLOWED_BY_THE_SERVER) {
    it(`grants STUDENT_BULK_UPLOAD to ${role}, which the server route admits`, () => {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.STUDENT_BULK_UPLOAD);
    });
  }

  // SUPER_ADMIN is not on the route's `@Roles` list but holds every
  // permission by design; it is exempt from the agreement check above.
  const ROLES_REFUSED_BY_THE_SERVER = [
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_REFUSED_BY_THE_SERVER) {
    it(`withholds STUDENT_BULK_UPLOAD from ${role}, which the server route refuses`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.STUDENT_BULK_UPLOAD);
    });
  }

  // Importing students creates them, so any role that may bulk-upload must
  // also be able to read the students it just created.
  it('pairs every bulk-upload grant with STUDENT_READ', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (permissions.includes(Permission.STUDENT_BULK_UPLOAD)) {
        expect(permissions, `${role} can bulk-upload but cannot read students`).toContain(
          Permission.STUDENT_READ,
        );
      }
    }
  });
});

describe('member-remove grant [8.11.8]', () => {
  /**
   * `DELETE /users/{id}` is declared `@Roles(ADMIN)` in
   * `server/src/modules/users/users.controller.ts` and removes only the
   * membership row (school access), not the account. The frontend gates the
   * "Remove from school" action on MEMBER_REMOVE, so only ADMIN may hold it.
   */
  it('grants MEMBER_REMOVE to ADMIN, which the server route admits', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.MEMBER_REMOVE);
  });

  const ROLES_REFUSED_BY_THE_SERVER = [
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_REFUSED_BY_THE_SERVER) {
    it(`withholds MEMBER_REMOVE from ${role}, which the server route refuses`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.MEMBER_REMOVE);
    });
  }

  // USER_DELETE (true account deletion) is deliberately granted to no staff
  // role — MEMBER_REMOVE must not quietly become a synonym for it.
  it('still grants USER_DELETE to no staff role', () => {
    for (const role of [UserRole.ADMIN, ...ROLES_REFUSED_BY_THE_SERVER]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.USER_DELETE);
    }
  });
});

describe('family read grants [5.1]', () => {
  /**
   * [5.1] opened a set of read routes to PARENT and STUDENT, each guarded by
   * an object-level linkage check (`FamilyAccessService`) rather than by a
   * new permission. The deliberate outcome is that **neither family role
   * gained a permission**: the three reads they already held were always
   * object-scoped, and the server — not this table — decides which objects.
   *
   * This block is the tripwire for that decision. If someone later adds a
   * permission here to "make the portal work", these tests fail and force
   * the question back into review.
   */
  const FAMILY_ROLES = [UserRole.PARENT, UserRole.STUDENT] as const;

  const FAMILY_PERMISSIONS = [
    Permission.STUDENT_READ,
    Permission.FEE_READ,
    Permission.INVOICE_READ,
    Permission.ATTENDANCE_READ,
    // [17.1.1] Calendar read — every tenant role, including family roles.
    Permission.CALENDAR_READ,
    // [19.1.1] D1 — guardian-visible published results are in scope.
    Permission.RESULT_READ,
    // [21.1.1] Routine read — families need to see the published timetable.
    Permission.ROUTINE_READ,
    // [22.1.1] D26 — families get only the two homework/syllabus reads.
    Permission.HOMEWORK_READ,
    Permission.SYLLABUS_READ,
    // [34.1.1] D4 — families get only PROGRAM_READ.
    Permission.PROGRAM_READ,
    // [52.1.1] D22/D45 — families may submit (own) applications.
    Permission.APPLICATION_SUBMIT,
  ] as const;

  for (const role of FAMILY_ROLES) {
    it(`grants ${role} exactly STUDENT_READ, FEE_READ, INVOICE_READ, ATTENDANCE_READ, CALENDAR_READ, RESULT_READ, ROUTINE_READ, HOMEWORK_READ, SYLLABUS_READ and PROGRAM_READ`, () => {
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual([...FAMILY_PERMISSIONS].sort());
    });
  }

  // PARENT and STUDENT are byte-identical by design (see audiences.ts) —
  // the portal is one route tree, not two.
  it('gives PARENT and STUDENT the same permission set', () => {
    expect(ROLE_PERMISSIONS[UserRole.PARENT]).toEqual(ROLE_PERMISSIONS[UserRole.STUDENT]);
  });

  /**
   * [19.1.1] D20's staff role table, pinned exactly — a role picking up
   * (or losing) an exam permission it shouldn't have passes every other
   * test in this file, since those check unrelated permission groups.
   */
  const EXAM_PERMISSIONS = [
    Permission.EXAM_MANAGE,
    Permission.MARK_ENTER,
    Permission.MARK_VIEW,
    Permission.RESULT_PROCESS,
    Permission.RESULT_PUBLISH,
    Permission.RESULT_READ,
  ] as const;

  const STAFF_EXAM_EXPECTATIONS: ReadonlyArray<readonly [UserRole, readonly Permission[]]> = [
    [UserRole.ADMIN, [...EXAM_PERMISSIONS]],
    [UserRole.ACCOUNTANT, []],
    [UserRole.EXECUTIVE, [Permission.MARK_VIEW, Permission.RESULT_READ]],
    [UserRole.TEACHER, [Permission.MARK_ENTER, Permission.MARK_VIEW, Permission.RESULT_READ]],
  ];

  for (const [role, expected] of STAFF_EXAM_EXPECTATIONS) {
    it(`grants ${role} exactly the D20 exam permission set`, () => {
      const actual = EXAM_PERMISSIONS.filter((permission) =>
        ROLE_PERMISSIONS[role].includes(permission),
      );
      expect([...actual].sort()).toEqual([...expected].sort());
    });
  }

  /**
   * [26.1.1] D11/D22 — promotion permissions are ADMIN-only. No other role
   * picks up PROMOTION_MANAGE or PROMOTION_OVERRIDE.
   */
  const PROMOTION_PERMISSIONS = [
    Permission.PROMOTION_MANAGE,
    Permission.PROMOTION_OVERRIDE,
  ] as const;

  const PROMOTION_EXPECTATIONS: ReadonlyArray<readonly [UserRole, readonly Permission[]]> = [
    [UserRole.ADMIN, [...PROMOTION_PERMISSIONS]],
    [UserRole.EXECUTIVE, []],
    [UserRole.TEACHER, []],
    [UserRole.ACCOUNTANT, []],
    [UserRole.PARENT, []],
    [UserRole.STUDENT, []],
  ];

  for (const [role, expected] of PROMOTION_EXPECTATIONS) {
    it(`grants ${role} exactly the D22 promotion permission set`, () => {
      const actual = PROMOTION_PERMISSIONS.filter((permission) =>
        ROLE_PERMISSIONS[role].includes(permission),
      );
      expect([...actual].sort()).toEqual([...expected].sort());
    });
  }

  /**
   * [22.1.1] D26's role table, pinned exactly — ADMIN and TEACHER hold all
   * six homework/syllabus permissions; STUDENT/PARENT hold exactly the two
   * `_READ` permissions and nothing else in this group.
   */
  const HOMEWORK_PERMISSIONS = [
    Permission.HOMEWORK_READ,
    Permission.HOMEWORK_ASSIGN,
    Permission.HOMEWORK_GRADE,
    Permission.HOMEWORK_IMPORT,
    Permission.SYLLABUS_READ,
    Permission.SYLLABUS_MANAGE,
  ] as const;
  const TEMPLATE_MANAGE = Permission.STUDY_PLAN_TEMPLATE_MANAGE;

  const STAFF_HOMEWORK_EXPECTATIONS: ReadonlyArray<readonly [UserRole, readonly Permission[]]> = [
    [UserRole.ADMIN, [...HOMEWORK_PERMISSIONS]],
    [UserRole.ACCOUNTANT, []],
    // [66.1.01] D9 — reads every plan; not SYLLABUS_MANAGE.
    [UserRole.EXECUTIVE, [Permission.SYLLABUS_READ]],
    [UserRole.TEACHER, [...HOMEWORK_PERMISSIONS]],
    [UserRole.STUDENT, [Permission.HOMEWORK_READ, Permission.SYLLABUS_READ]],
    [UserRole.PARENT, [Permission.HOMEWORK_READ, Permission.SYLLABUS_READ]],
  ];

  // [66.1.01] D28 — only ADMIN and EXECUTIVE manage study-plan templates.
  for (const role of Object.values(UserRole)) {
    if (role === UserRole.SUPER_ADMIN) continue;
    const holds = role === UserRole.ADMIN || role === UserRole.EXECUTIVE;
    it(`${holds ? 'grants' : 'does not grant'} ${role} STUDY_PLAN_TEMPLATE_MANAGE`, () => {
      expect(ROLE_PERMISSIONS[role].includes(TEMPLATE_MANAGE)).toBe(holds);
    });
  }

  for (const [role, expected] of STAFF_HOMEWORK_EXPECTATIONS) {
    it(`grants ${role} exactly the D26 homework/syllabus permission set`, () => {
      const actual = HOMEWORK_PERMISSIONS.filter((permission) =>
        ROLE_PERMISSIONS[role].includes(permission),
      );
      expect([...actual].sort()).toEqual([...expected].sort());
    });
  }

  /**
   * [34.1.1] D4's role table, pinned exactly — ADMIN and EXECUTIVE hold all
   * three program permissions; TEACHER holds READ+RECORD; STUDENT/PARENT
   * hold exactly PROGRAM_READ; ACCOUNTANT holds none.
   */
  const PROGRAM_PERMISSIONS = [
    Permission.PROGRAM_READ,
    Permission.PROGRAM_MANAGE,
    Permission.PROGRAM_RECORD,
  ] as const;

  const STAFF_PROGRAM_EXPECTATIONS: ReadonlyArray<readonly [UserRole, readonly Permission[]]> = [
    [UserRole.ADMIN, [...PROGRAM_PERMISSIONS]],
    [UserRole.EXECUTIVE, [...PROGRAM_PERMISSIONS]],
    [UserRole.ACCOUNTANT, []],
    [UserRole.TEACHER, [Permission.PROGRAM_READ, Permission.PROGRAM_RECORD]],
    [UserRole.STUDENT, [Permission.PROGRAM_READ]],
    [UserRole.PARENT, [Permission.PROGRAM_READ]],
  ];

  for (const [role, expected] of STAFF_PROGRAM_EXPECTATIONS) {
    it(`grants ${role} exactly the D4 program permission set`, () => {
      const actual = PROGRAM_PERMISSIONS.filter((permission) =>
        ROLE_PERMISSIONS[role].includes(permission),
      );
      expect([...actual].sort()).toEqual([...expected].sort());
    });
  }

  it('grants ACR_WRITE to ADMIN only, ACR_READ also to COMMITTEE [28.1.1, #1358]', () => {
    for (const role of Object.values(UserRole)) {
      const expected = role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
      expect(ROLE_PERMISSIONS[role].includes(Permission.ACR_READ)).toBe(
        expected || role === UserRole.COMMITTEE,
      );
      expect(ROLE_PERMISSIONS[role].includes(Permission.ACR_WRITE)).toBe(expected);
    }
  });

  /**
   * [27.1] ADMISSION_REVIEW opens the applicant review routes. Pinned to
   * ADMIN and OFFICE_STAFF (#1358 D16) so another role can't silently gain it.
   */
  it('grants ADMISSION_REVIEW to ADMIN and OFFICE_STAFF only [#1358]', () => {
    for (const role of Object.values(UserRole)) {
      const expected =
        role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN || role === UserRole.OFFICE_STAFF;
      expect(ROLE_PERMISSIONS[role].includes(Permission.ADMISSION_REVIEW)).toBe(expected);
    }
  });

  it('grants COMMITTEE_REPORT_READ to ADMIN, EXECUTIVE and COMMITTEE only (8.10.7)', () => {
    const holders: UserRole[] = [
      UserRole.ADMIN,
      UserRole.EXECUTIVE,
      UserRole.COMMITTEE,
      UserRole.SUPER_ADMIN,
    ];
    for (const role of Object.values(UserRole)) {
      expect(ROLE_PERMISSIONS[role].includes(Permission.COMMITTEE_REPORT_READ), role).toBe(
        holders.includes(role),
      );
    }
  });

  /**
   * `GET /payments/student/{studentId}` admits PARENT and STUDENT since
   * [5.1], and already admitted TEACHER and EXECUTIVE. None of them hold
   * PAYMENT_READ, because that permission means the *tenant-wide ledger*
   * (`GET /payments`, ADMIN + ACCOUNTANT). Per-student payment history is
   * authorized by the caller's relationship to the student instead.
   */
  it('withholds PAYMENT_READ from every role the per-student payments route admits but the ledger refuses', () => {
    for (const role of [UserRole.TEACHER, UserRole.EXECUTIVE, UserRole.PARENT, UserRole.STUDENT]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.PAYMENT_READ);
    }
  });

  it('keeps PAYMENT_READ on exactly the roles the tenant-wide ledger route admits', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.PAYMENT_READ);
    expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).toContain(Permission.PAYMENT_READ);
  });

  /**
   * The roster (`GET /students`) stays staff-only, while `/students/mine`
   * and `/students/{id}` are open to family roles. Both are gated on the
   * same STUDENT_READ — which is precisely why STUDENT_READ was *not* split
   * into STUDENT_READ/STUDENT_LIST: the split would have described a
   * distinction the server already makes at the object level.
   */
  it('keeps STUDENT_READ as the single student-read permission, held by staff and family alike', () => {
    for (const role of [
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.STUDENT_READ);
    }
    // No STUDENT_LIST was introduced — [5.1] settled against the split.
    expect(Object.keys(Permission)).not.toContain('STUDENT_LIST');
  });

  /**
   * Staff-only write and triage surfaces that [5.1] deliberately did not
   * widen. A family role holding any of these would mean the server's
   * `@Roles` lists and this table had drifted apart again.
   */
  it('withholds every staff-only fee/invoice capability from family roles', () => {
    const STAFF_ONLY = [
      Permission.STUDENT_CREATE,
      Permission.STUDENT_UPDATE,
      Permission.STUDENT_DELETE,
      Permission.STUDENT_BULK_UPLOAD,
      Permission.GUARDIAN_READ,
      Permission.FEE_STRUCTURE_CREATE,
      Permission.FEE_STRUCTURE_UPDATE,
      Permission.FEE_STRUCTURE_DELETE,
      Permission.FEE_GENERATE,
      Permission.FEE_COLLECT,
      Permission.INVOICE_CREATE,
      Permission.INVOICE_DELETE,
      Permission.PAYMENT_RECORD,
      Permission.PAYMENT_REFUND,
      Permission.COMMUNICATION_SEND,
      Permission.REPORTS_VIEW,
      Permission.ATTENDANCE_MARK,
      Permission.ATTENDANCE_CORRECT,
      Permission.ATTENDANCE_DEVICE_MANAGE,
      // [36.1.1] Staff attendance/leave — no family-role stake in these.
      Permission.STAFF_ATTENDANCE_READ,
      Permission.STAFF_ATTENDANCE_MARK,
      Permission.LEAVE_APPROVE,
    ] as const;

    for (const role of FAMILY_ROLES) {
      for (const permission of STAFF_ONLY) {
        expect(ROLE_PERMISSIONS[role], `${role} should not hold ${permission}`).not.toContain(
          permission,
        );
      }
    }
  });
});

describe('attendance role grants [9.2]', () => {
  it('grants ATTENDANCE_MARK to TEACHER', () => {
    expect(ROLE_PERMISSIONS[UserRole.TEACHER]).toContain(Permission.ATTENDANCE_MARK);
  });

  it('withholds ATTENDANCE_MARK from ACCOUNTANT', () => {
    expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).not.toContain(Permission.ATTENDANCE_MARK);
  });

  it('grants ATTENDANCE_READ to PARENT and STUDENT', () => {
    expect(ROLE_PERMISSIONS[UserRole.PARENT]).toContain(Permission.ATTENDANCE_READ);
    expect(ROLE_PERMISSIONS[UserRole.STUDENT]).toContain(Permission.ATTENDANCE_READ);
  });

  it('withholds ATTENDANCE_CORRECT from every role except ADMIN and SUPER_ADMIN', () => {
    for (const role of [
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.ATTENDANCE_CORRECT);
    }
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.ATTENDANCE_CORRECT);
  });
});

describe('staff attendance & leave role grants [36.1.1]', () => {
  const TENANT_STAFF_ROLES = [
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
  ] as const;

  for (const role of TENANT_STAFF_ROLES) {
    it(`grants STAFF_ATTENDANCE_READ and STAFF_ATTENDANCE_MARK to ${role}`, () => {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.STAFF_ATTENDANCE_READ);
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.STAFF_ATTENDANCE_MARK);
    });
  }

  it('withholds STAFF_ATTENDANCE_READ and STAFF_ATTENDANCE_MARK from PARENT and STUDENT', () => {
    for (const role of [UserRole.PARENT, UserRole.STUDENT]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.STAFF_ATTENDANCE_READ);
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.STAFF_ATTENDANCE_MARK);
    }
  });

  it('grants LEAVE_APPROVE to ADMIN and EXECUTIVE only', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.LEAVE_APPROVE);
    expect(ROLE_PERMISSIONS[UserRole.EXECUTIVE]).toContain(Permission.LEAVE_APPROVE);
  });

  it('withholds LEAVE_APPROVE from TEACHER and ACCOUNTANT', () => {
    expect(ROLE_PERMISSIONS[UserRole.TEACHER]).not.toContain(Permission.LEAVE_APPROVE);
    expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).not.toContain(Permission.LEAVE_APPROVE);
  });

  it('grants LEAVE_APPROVE to SUPER_ADMIN, which holds every permission', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain(Permission.LEAVE_APPROVE);
  });
});

describe('[10.4] drift decisions', () => {
  // G3 — resolves the "can import 500 but cannot add one by hand"
  // contradiction: ACCOUNTANT gains create/update on students and guardians.
  it('grants STUDENT_CREATE, STUDENT_UPDATE, GUARDIAN_CREATE and GUARDIAN_UPDATE to ACCOUNTANT', () => {
    for (const permission of [
      Permission.STUDENT_CREATE,
      Permission.STUDENT_UPDATE,
      Permission.GUARDIAN_CREATE,
      Permission.GUARDIAN_UPDATE,
    ]) {
      expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).toContain(permission);
    }
  });

  // G4 — reference-data read every staff screen needs.
  it('grants ACADEMIC_STRUCTURE_READ to every staff role', () => {
    for (const role of [
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
    ]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.ACADEMIC_STRUCTURE_READ);
    }
  });

  // G5 — the per-student Communications tab, visible via STUDENT_READ.
  it('grants COMMUNICATION_LOG_READ to ACCOUNTANT, EXECUTIVE and TEACHER', () => {
    for (const role of [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.COMMUNICATION_LOG_READ);
    }
  });

  // G6 — the per-entity Activity tab, distinct from the tenant-wide
  // AUDIT_LOG_READ ledger (ADMIN only).
  it('grants AUDIT_ENTITY_HISTORY_READ to every staff role, but AUDIT_LOG_READ to ADMIN only', () => {
    for (const role of [
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
    ]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.AUDIT_ENTITY_HISTORY_READ);
    }
    for (const role of [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.AUDIT_LOG_READ);
    }
  });

  // G12 — EXECUTIVE still has no surface for guardians.
  it('withholds GUARDIAN_READ from EXECUTIVE', () => {
    expect(ROLE_PERMISSIONS[UserRole.EXECUTIVE]).not.toContain(Permission.GUARDIAN_READ);
  });

  // G15 — new value mirroring STUDENT_DELETE.
  it('grants GUARDIAN_DELETE to ADMIN only', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.GUARDIAN_DELETE);
    for (const role of [
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.GUARDIAN_DELETE);
    }
  });

  // G17 — reserved for endpoints that don't exist yet; granted to ADMIN so
  // the value isn't dead weight, but no route consumes it today (see
  // permission-matrix.e2e-spec.ts's UI_ONLY_PERMISSIONS).
  it('grants INVOICE_DELETE and PAYMENT_REFUND to ADMIN only, and USER_DELETE to no staff role', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.INVOICE_DELETE);
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.PAYMENT_REFUND);
    for (const role of [
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.USER_DELETE);
    }
  });
});

describe('roleHasPermission', () => {
  it('returns true when ADMIN holds USER_CREATE', () => {
    expect(roleHasPermission(UserRole.ADMIN, Permission.USER_CREATE)).toBe(true);
  });

  it('returns false when TEACHER lacks USER_CREATE', () => {
    expect(roleHasPermission(UserRole.TEACHER, Permission.USER_CREATE)).toBe(false);
  });

  it('returns false for a null role', () => {
    expect(roleHasPermission(null, Permission.USER_CREATE)).toBe(false);
  });

  it('returns false for an unrecognized role string', () => {
    expect(roleHasPermission('NOT_A_ROLE', Permission.USER_CREATE)).toBe(false);
  });

  // A role string matching an inherited Object.prototype member (not an own
  // property of ROLE_PERMISSIONS) must resolve to "holds nothing", not throw
  // or fall through to that inherited value.
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'returns false for the inherited property name %s, not the prototype value',
    (role) => {
      expect(() => roleHasPermission(role, Permission.USER_CREATE)).not.toThrow();
      expect(roleHasPermission(role, Permission.USER_CREATE)).toBe(false);
    },
  );
});

describe('backup role grants [14.2.1]', () => {
  /**
   * Backup export and restore are destructive, tenant-wide operations with
   * no role-scoped partial form, so only ADMIN holds the permission
   * explicitly. SUPER_ADMIN holds it via `Object.values(Permission)`.
   * No server route requires it yet — see UI_ONLY_PERMISSIONS in
   * server/src/permission-matrix.e2e-spec.ts.
   */
  it('grants BACKUP_MANAGE to ADMIN', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.BACKUP_MANAGE);
  });

  it('grants BACKUP_MANAGE to SUPER_ADMIN, which holds every permission', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain(Permission.BACKUP_MANAGE);
  });

  const ROLES_WITHOUT_BACKUP = [
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_WITHOUT_BACKUP) {
    it(`withholds BACKUP_MANAGE from ${role}`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.BACKUP_MANAGE);
    });
  }
});

describe('fees rebuild role grants [16.2.1]', () => {
  it('grants ADMIN all six new fees-rebuild permissions', () => {
    for (const permission of [
      Permission.FEE_APPROVE,
      Permission.FEE_GENERATE,
      Permission.PAYMENT_REVERSE,
      Permission.REPORT_COLLECTIONS_READ,
      Permission.SCHEDULE_MANAGE,
      Permission.DISCOUNT_RULE_MANAGE,
    ]) {
      expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(permission);
    }
  });

  // ACCOUNTANT gets the day-to-day fee-ops permissions but not the two
  // approval-adjacent ones — approving a pending action and reversing a
  // recorded payment both undo/override money already moved.
  it('grants ACCOUNTANT the operational fees permissions', () => {
    for (const permission of [
      Permission.FEE_GENERATE,
      Permission.SCHEDULE_MANAGE,
      Permission.REPORT_COLLECTIONS_READ,
      Permission.DISCOUNT_RULE_MANAGE,
    ]) {
      expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).toContain(permission);
    }
  });

  it('withholds FEE_APPROVE and PAYMENT_REVERSE from ACCOUNTANT', () => {
    expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).not.toContain(Permission.FEE_APPROVE);
    expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).not.toContain(Permission.PAYMENT_REVERSE);
  });

  it('grants EXECUTIVE only the read-only REPORT_COLLECTIONS_READ, not the write permissions', () => {
    expect(ROLE_PERMISSIONS[UserRole.EXECUTIVE]).toContain(Permission.REPORT_COLLECTIONS_READ);
    for (const permission of [
      Permission.FEE_APPROVE,
      Permission.FEE_GENERATE,
      Permission.PAYMENT_REVERSE,
      Permission.SCHEDULE_MANAGE,
      Permission.DISCOUNT_RULE_MANAGE,
    ]) {
      expect(ROLE_PERMISSIONS[UserRole.EXECUTIVE]).not.toContain(permission);
    }
  });

  it('SUPER_ADMIN holds every new permission via Object.values(Permission)', () => {
    for (const permission of [
      Permission.FEE_APPROVE,
      Permission.PAYMENT_REVERSE,
      Permission.REPORT_COLLECTIONS_READ,
      Permission.SCHEDULE_MANAGE,
      Permission.DISCOUNT_RULE_MANAGE,
    ]) {
      expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain(permission);
    }
  });
});

describe('calendar role grants [17.1.1]', () => {
  const TENANT_ROLES = [
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of TENANT_ROLES) {
    it(`grants CALENDAR_READ to ${role}`, () => {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.CALENDAR_READ);
    });
  }

  it('grants CALENDAR_MANAGE to ADMIN', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.CALENDAR_MANAGE);
  });

  it('grants CALENDAR_MANAGE to SUPER_ADMIN, which holds every permission', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain(Permission.CALENDAR_MANAGE);
  });

  const ROLES_WITHOUT_CALENDAR_MANAGE = [
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_WITHOUT_CALENDAR_MANAGE) {
    it(`withholds CALENDAR_MANAGE from ${role}`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.CALENDAR_MANAGE);
    });
  }
});

describe('grading-scale permissions [20.1.1]', () => {
  it('grants GRADING_SCALE_MANAGE to ADMIN', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.GRADING_SCALE_MANAGE);
  });

  it('grants GRADING_SCALE_MANAGE to SUPER_ADMIN, which holds every permission', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain(Permission.GRADING_SCALE_MANAGE);
  });

  // No read permission: teachers/executives see scales implicitly through
  // results, not as a standalone list — so every non-admin role is denied.
  const ROLES_WITHOUT_GRADING_SCALE_MANAGE = [
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_WITHOUT_GRADING_SCALE_MANAGE) {
    it(`withholds GRADING_SCALE_MANAGE from ${role}`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.GRADING_SCALE_MANAGE);
    });
  }
});

describe('routine role grants [21.1.1]', () => {
  // Everyone with a stake in a published class routine can read it,
  // including families — unlike CALENDAR_READ, ACCOUNTANT has no stake
  // and is deliberately excluded.
  const ROLES_WITH_ROUTINE_READ = [
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_WITH_ROUTINE_READ) {
    it(`grants ROUTINE_READ to ${role}`, () => {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.ROUTINE_READ);
    });
  }

  it('withholds ROUTINE_READ from ACCOUNTANT', () => {
    expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).not.toContain(Permission.ROUTINE_READ);
  });

  it('grants ROUTINE_MANAGE to ADMIN', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.ROUTINE_MANAGE);
  });

  it('grants ROUTINE_MANAGE to SUPER_ADMIN, which holds every permission', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain(Permission.ROUTINE_MANAGE);
  });

  const ROLES_WITHOUT_ROUTINE_MANAGE = [
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_WITHOUT_ROUTINE_MANAGE) {
    it(`withholds ROUTINE_MANAGE from ${role}`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.ROUTINE_MANAGE);
    });
  }
});

describe('student lifecycle grants [39.1.1] D22', () => {
  const ALL_FIVE = [
    Permission.STUDENT_LIFECYCLE_MANAGE,
    Permission.STUDENT_NOTES_READ,
    Permission.STUDENT_NOTES_WRITE,
    Permission.STUDENT_RECORDS_READ,
    Permission.STUDENT_RECORDS_WRITE,
  ];

  for (const role of [UserRole.ADMIN, UserRole.EXECUTIVE]) {
    it(`grants all five to ${role}`, () => {
      for (const p of ALL_FIVE) expect(ROLE_PERMISSIONS[role]).toContain(p);
    });
  }

  it('gives TEACHER notes r/w and records read only', () => {
    const t = ROLE_PERMISSIONS[UserRole.TEACHER];
    expect(t).toContain(Permission.STUDENT_NOTES_READ);
    expect(t).toContain(Permission.STUDENT_NOTES_WRITE);
    expect(t).toContain(Permission.STUDENT_RECORDS_READ);
    expect(t).not.toContain(Permission.STUDENT_LIFECYCLE_MANAGE);
    expect(t).not.toContain(Permission.STUDENT_RECORDS_WRITE);
  });

  for (const role of [UserRole.ACCOUNTANT, UserRole.PARENT, UserRole.STUDENT]) {
    it(`gives ${role} none of the five`, () => {
      for (const p of ALL_FIVE) expect(ROLE_PERMISSIONS[role]).not.toContain(p);
    });
  }
});

describe('print permission grants [32.1.1]', () => {
  const PRINT: Permission[] = [
    Permission.PRINT_TEMPLATE_MANAGE,
    Permission.DOCUMENT_PRINT,
    Permission.PRINT_HISTORY_READ,
    Permission.DOCUMENT_REVOKE,
  ];
  const held = (role: UserRole) => ROLE_PERMISSIONS[role].filter((p) => PRINT.includes(p));

  it('ADMIN and SUPER_ADMIN hold all four', () => {
    expect(new Set(held(UserRole.ADMIN))).toEqual(new Set(PRINT));
    expect(new Set(held(UserRole.SUPER_ADMIN))).toEqual(new Set(PRINT));
  });

  it('ACCOUNTANT has DOCUMENT_PRINT only', () => {
    expect(held(UserRole.ACCOUNTANT)).toEqual([Permission.DOCUMENT_PRINT]);
  });

  it('EXECUTIVE has PRINT_HISTORY_READ only', () => {
    expect(held(UserRole.EXECUTIVE)).toEqual([Permission.PRINT_HISTORY_READ]);
  });

  it('TEACHER, PARENT and STUDENT have none', () => {
    for (const r of [UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT]) {
      expect(held(r)).toEqual([]);
    }
  });
});

describe('CERTIFICATE_ISSUE [48.1.01]', () => {
  it.each([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.OFFICE_STAFF])(
    'is held by %s',
    (r) => expect(ROLE_PERMISSIONS[r]).toContain(Permission.CERTIFICATE_ISSUE),
  );

  // ACCOUNTANT holds DOCUMENT_PRINT and must still not issue a TC (D6).
  it.each([
    UserRole.ACCOUNTANT,
    UserRole.EXAM_CONTROLLER,
    UserRole.TEACHER,
    UserRole.COMMITTEE,
    UserRole.PARENT,
    UserRole.STUDENT,
  ])('is not held by %s', (r) =>
    expect(ROLE_PERMISSIONS[r]).not.toContain(Permission.CERTIFICATE_ISSUE),
  );
});

describe('CURRICULUM_PRESET_APPLY [35.1.1]', () => {
  it('is held by ADMIN and SUPER_ADMIN only', () => {
    expect(roleHasPermission(UserRole.ADMIN, Permission.CURRICULUM_PRESET_APPLY)).toBe(true);
    expect(roleHasPermission(UserRole.SUPER_ADMIN, Permission.CURRICULUM_PRESET_APPLY)).toBe(true);
    for (const r of [UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.EXECUTIVE]) {
      expect(roleHasPermission(r, Permission.CURRICULUM_PRESET_APPLY)).toBe(false);
    }
  });
});

describe('new role grants [#1358]', () => {
  const NEW_ROLES = [UserRole.OFFICE_STAFF, UserRole.EXAM_CONTROLLER, UserRole.COMMITTEE] as const;
  const has = (r: UserRole, p: Permission) => ROLE_PERMISSIONS[r].includes(p);

  it('COMMITTEE is read-only and sees no student data', () => {
    for (const p of ROLE_PERMISSIONS[UserRole.COMMITTEE]) {
      expect(p, `COMMITTEE must not hold ${p}`).not.toMatch(
        /_(CREATE|UPDATE|DELETE|WRITE|MANAGE)$/,
      );
    }
    expect(has(UserRole.COMMITTEE, Permission.STUDENT_READ)).toBe(false);
    // D16: the collections report lists student_name per payment.
    expect(has(UserRole.COMMITTEE, Permission.REPORT_COLLECTIONS_READ)).toBe(false);
  });

  it('no new role can move money or change settings', () => {
    const forbidden = [
      Permission.FEE_COLLECT,
      Permission.PAYMENT_RECORD,
      Permission.PAYMENT_REFUND,
      Permission.PAYMENT_REVERSE,
      Permission.FEE_APPROVE,
      Permission.SETTINGS_MANAGE,
      Permission.BACKUP_MANAGE,
    ];
    for (const r of NEW_ROLES) {
      for (const p of forbidden) expect(has(r, p), `${r} must not hold ${p}`).toBe(false);
    }
  });

  // D16 "exact lists": pin each whole row, so a stray grant fails. COMMITTEE
  // drops REPORT_COLLECTIONS_READ, as D16 allows: that report names students.
  const D16: Record<(typeof NEW_ROLES)[number], Permission[]> = {
    [UserRole.OFFICE_STAFF]: [
      Permission.APPLICATION_SUBMIT, // [52.1.1] D22
      Permission.APPLICATION_MANAGE,
      Permission.CERTIFICATE_ISSUE, // [48.1.01] D6
      Permission.STUDENT_CREATE,
      Permission.STUDENT_READ,
      Permission.STUDENT_UPDATE,
      Permission.STUDENT_BULK_UPLOAD,
      Permission.STUDENT_RECORDS_READ,
      Permission.STUDENT_RECORDS_WRITE,
      Permission.GUARDIAN_CREATE,
      Permission.GUARDIAN_READ,
      Permission.GUARDIAN_UPDATE,
      Permission.ADMISSION_REVIEW,
      Permission.ACADEMIC_STRUCTURE_READ,
      Permission.ATTENDANCE_READ,
      Permission.CALENDAR_READ,
      Permission.ROUTINE_READ,
      Permission.FEE_READ,
      Permission.INVOICE_READ,
      Permission.COMMUNICATION_SEND,
      Permission.COMMUNICATION_BULK_SEND,
      Permission.COMMUNICATION_LOG_READ,
      Permission.DOCUMENT_PRINT,
      Permission.PRINT_HISTORY_READ,
      Permission.DASHBOARD_VIEW,
      Permission.RESULT_READ,
      Permission.STAFF_ATTENDANCE_READ,
      Permission.STAFF_ATTENDANCE_MARK,
    ],
    [UserRole.EXAM_CONTROLLER]: [
      Permission.STEP_UP_REQUEST, // [2639] approver role
      Permission.APPLICATION_SUBMIT, // [52.1.1] D22
      Permission.EXAM_MANAGE,
      Permission.SEAT_PLAN_MANAGE,
      Permission.MARK_VIEW,
      Permission.RESULT_PROCESS,
      Permission.RESULT_PUBLISH,
      Permission.RESULT_READ,
      Permission.DOCUMENT_PRINT,
      Permission.PRINT_HISTORY_READ,
      Permission.STUDENT_READ,
      Permission.ACADEMIC_STRUCTURE_READ,
      Permission.ATTENDANCE_READ,
      Permission.ROUTINE_READ,
      Permission.CALENDAR_READ,
      Permission.DASHBOARD_VIEW,
      Permission.STAFF_ATTENDANCE_READ,
      Permission.STAFF_ATTENDANCE_MARK,
    ],
    [UserRole.COMMITTEE]: [
      Permission.DASHBOARD_VIEW,
      Permission.REPORTS_VIEW, // [8.15.53] D14: counts only, small cells hidden
      Permission.COMMITTEE_REPORT_READ, // [8.10.7] D44
      Permission.ACR_READ,
      Permission.ACADEMIC_STRUCTURE_READ,
      Permission.CALENDAR_READ,
    ],
  };

  for (const role of NEW_ROLES) {
    it(`grants ${role} exactly its D16 list`, () => {
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual([...D16[role]].sort());
    });
  }

  it('EXAM_CONTROLLER cannot enter marks or edit print templates', () => {
    expect(has(UserRole.EXAM_CONTROLLER, Permission.MARK_ENTER)).toBe(false);
    expect(has(UserRole.EXAM_CONTROLLER, Permission.PRINT_TEMPLATE_MANAGE)).toBe(false);
  });

  it('OFFICE_STAFF cannot delete students or run lifecycle changes', () => {
    expect(has(UserRole.OFFICE_STAFF, Permission.STUDENT_DELETE)).toBe(false);
    expect(has(UserRole.OFFICE_STAFF, Permission.STUDENT_LIFECYCLE_MANAGE)).toBe(false);
  });
});

describe('MY_CLASS_VIEW [47.1.1] D11', () => {
  it('is held by TEACHER and no other tenant role (SUPER_ADMIN holds every permission)', () => {
    const holders = Object.values(UserRole).filter(
      (r) => r !== UserRole.SUPER_ADMIN && ROLE_PERMISSIONS[r]?.includes(Permission.MY_CLASS_VIEW),
    );
    expect(holders).toEqual([UserRole.TEACHER]);
  });
});

describe('applications grants [52.1.1]', () => {
  const holders = (p: Permission) =>
    Object.values(UserRole).filter((r) => ROLE_PERMISSIONS[r]?.includes(p));

  it('every role except COMMITTEE holds APPLICATION_SUBMIT (D45)', () => {
    expect(holders(Permission.APPLICATION_SUBMIT).sort()).toEqual(
      Object.values(UserRole)
        .filter((r) => r !== UserRole.COMMITTEE)
        .sort(),
    );
  });

  it('APPLICATION_MANAGE is held by ADMIN, EXECUTIVE, OFFICE_STAFF, SUPER_ADMIN only', () => {
    expect(holders(Permission.APPLICATION_MANAGE).sort()).toEqual(
      [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.OFFICE_STAFF, UserRole.SUPER_ADMIN].sort(),
    );
  });
});

describe('[67.1.01] alert permissions', () => {
  const alertPerms = [Permission.ALERT_SEND, Permission.ALERT_REPORT_READ];

  it('ADMIN and EXECUTIVE hold both', () => {
    for (const role of [UserRole.ADMIN, UserRole.EXECUTIVE]) {
      for (const p of alertPerms) expect(roleHasPermission(role, p), `${role} ${p}`).toBe(true);
    }
  });

  it('no other tenant role holds either', () => {
    const others = [
      UserRole.ACCOUNTANT,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
    ];
    for (const role of others) {
      for (const p of alertPerms) expect(roleHasPermission(role, p), `${role} ${p}`).toBe(false);
    }
  });
});

describe('[Epic 68 JOBS-03] teacher messaging', () => {
  it('TEACHER no longer holds COMMUNICATION_SEND', () => {
    expect(ROLE_PERMISSIONS[UserRole.TEACHER]).not.toContain(Permission.COMMUNICATION_SEND);
  });
});

describe('STEP_UP_REQUEST [2639]', () => {
  it('is held by ADMIN, ACCOUNTANT, EXAM_CONTROLLER and SUPER_ADMIN only', () => {
    const holders = Object.values(UserRole).filter((role) =>
      ROLE_PERMISSIONS[role].includes(Permission.STEP_UP_REQUEST),
    );
    expect(holders.sort()).toEqual(
      [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXAM_CONTROLLER, UserRole.SUPER_ADMIN].sort(),
    );
  });
});

describe('arrival notice permissions (84.1.1, D15/D16)', () => {
  const MANAGE = Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE;
  const LOCK = Permission.ATTENDANCE_ARRIVAL_NOTICE_LOCK;
  const holders = (p: Permission) =>
    Object.values(UserRole).filter(
      (r) => r !== UserRole.SUPER_ADMIN && ROLE_PERMISSIONS[r].includes(p),
    );

  it('MANAGE goes to exactly TEACHER, ADMIN (school admin) and EXECUTIVE', () => {
    expect(holders(MANAGE).sort()).toEqual(
      [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER].sort(),
    );
  });

  it('LOCK goes to exactly ADMIN and EXECUTIVE (the principal, D16)', () => {
    expect(holders(LOCK).sort()).toEqual([UserRole.ADMIN, UserRole.EXECUTIVE].sort());
  });

  it('STUDENT, PARENT and ACCOUNTANT have neither', () => {
    for (const r of [UserRole.STUDENT, UserRole.PARENT, UserRole.ACCOUNTANT]) {
      expect(ROLE_PERMISSIONS[r]).not.toContain(MANAGE);
      expect(ROLE_PERMISSIONS[r]).not.toContain(LOCK);
    }
  });
});

describe('INVOICE_SEND [#3033]', () => {
  it.each([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTANT])('%s holds it', (role) => {
    expect(roleHasPermission(role, Permission.INVOICE_SEND)).toBe(true);
  });

  it('no other role holds it (OFFICE_STAFF reads invoices but cannot send)', () => {
    const holders = Object.values(UserRole).filter((r) =>
      roleHasPermission(r, Permission.INVOICE_SEND),
    );
    expect(holders.sort()).toEqual(
      [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTANT].sort(),
    );
  });
});

describe('REPORTS_DESIGN [8.15.8]', () => {
  it('ADMIN and SUPER_ADMIN hold it', () => {
    expect(roleHasPermission(UserRole.ADMIN, Permission.REPORTS_DESIGN)).toBe(true);
    expect(roleHasPermission(UserRole.SUPER_ADMIN, Permission.REPORTS_DESIGN)).toBe(true);
  });

  it.each([
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.COMMITTEE,
    UserRole.PARENT,
  ])('%s does not hold it (D9: authoring is ADMIN only)', (role) => {
    expect(roleHasPermission(role, Permission.REPORTS_DESIGN)).toBe(false);
  });
});

describe('REPORTS_VIEW for COMMITTEE [8.15.53]', () => {
  it('COMMITTEE can open reports but cannot export or design them', () => {
    expect(roleHasPermission(UserRole.COMMITTEE, Permission.REPORTS_VIEW)).toBe(true);
    expect(roleHasPermission(UserRole.COMMITTEE, Permission.REPORTS_EXPORT)).toBe(false);
    expect(roleHasPermission(UserRole.COMMITTEE, Permission.REPORTS_DESIGN)).toBe(false);
  });
});

describe('REPORTS_VIEW for TEACHER [8.15.24]', () => {
  it('a TEACHER can run reports but not export or design them (D9)', () => {
    expect(roleHasPermission(UserRole.TEACHER, Permission.REPORTS_VIEW)).toBe(true);
    expect(roleHasPermission(UserRole.TEACHER, Permission.REPORTS_EXPORT)).toBe(false);
    expect(roleHasPermission(UserRole.TEACHER, Permission.REPORTS_DESIGN)).toBe(false);
  });
});
