import { ACR_CRITERIA_SLOTS, ADMIT_CARD_SITTING_SLOTS, DocumentKind } from '../enums/print';

export interface FieldDef {
  key: string;
  type: 'text' | 'image' | 'qr';
  /** i18n key for the field's label in the template designer. */
  labelKey: string;
  /** Preview value shown in the designer (a placeholder name for image fields). */
  sample: string;
  /** Worst-case value, used to check text overflow (D14). */
  longestSample?: string | undefined;
  /** Typed by the person issuing the document, not resolved from data (D3). */
  issueTime?: { maxLength: number } | undefined;
}

const f = (
  key: string,
  type: FieldDef['type'],
  sample: string,
  longestSample?: string,
): FieldDef => ({ key, type, labelKey: `print.field.${key}`, sample, longestSample });

const issue = (key: string, sample: string, maxLength: number): FieldDef => ({
  ...f(key, 'text', sample),
  issueTime: { maxLength },
});

const SCHOOL: FieldDef[] = [
  f(
    'school.name',
    'text',
    'Biddaloy High School',
    'Government Laboratory High School and College, Dhaka',
  ),
  f(
    'school.name_bn',
    'text',
    'বিদ্যালয় উচ্চ বিদ্যালয়',
    'সরকারি ল্যাবরেটরি উচ্চ বিদ্যালয় ও কলেজ, ঢাকা',
  ),
  f(
    'school.address',
    'text',
    '12 Green Road, Dhaka',
    '12/A Green Road, Dhanmondi, Dhaka-1205, Bangladesh',
  ),
  f('school.phone', 'text', '01711-000000'),
  f('school.eiin', 'text', '108765'),
  f('school.logo', 'image', 'logo'),
  f('school.website_url', 'text', 'https://school.example.com'),
  f('school.website_qr', 'qr', 'https://school.example.com'),
];

const COMMON_TAIL: FieldDef[] = [
  f('card.valid_until', 'text', '31 Dec 2027'),
  f('print.copyLabel', 'text', 'Copy 2'),
  f('print.issue_date', 'text', '01 Jan 2027'),
  f('print.verify_qr', 'qr', 'https://example.com/verify/abc123'),
];

// No print.verify_qr and no photo: an ACR is confidential and must never be publicly verifiable.
const ACR_TAIL: FieldDef[] = [
  f('print.copyLabel', 'text', 'Copy 2'),
  f('print.issue_date', 'text', '01 Jan 2027'),
];

const ACR_CRITERIA: FieldDef[] = Array.from(
  { length: ACR_CRITERIA_SLOTS },
  (_, i) => i + 1,
).flatMap((n) => [
  f(`acr.criterion.${n}.label`, 'text', 'Punctuality and attendance'),
  f(`acr.criterion.${n}.label_bn`, 'text', 'সময়ানুবর্তিতা ও উপস্থিতি'),
  f(`acr.criterion.${n}.score`, 'text', '4'),
]);

const STUDENT_DOC: FieldDef[] = [
  f('student.name', 'text', 'Mohammad Rahim Uddin', 'Mohammad Abdullah Al Mamun Rahim Uddin'),
  f('student.name_bn', 'text', 'মোহাম্মদ রহিম উদ্দিন', 'মোহাম্মদ আব্দুল্লাহ আল মামুন রহিম উদ্দিন'),
  f('student.father_name', 'text', 'Abdul Karim'),
  f('student.mother_name', 'text', 'Rahima Begum'),
  f('student.class', 'text', 'Class 8'),
  f('student.section', 'text', 'A'),
  f('student.roll', 'text', '12'),
  f('student.registration_number', 'text', '2027-000123'),
  f('student.date_of_birth', 'text', '05 May 2013'),
  f('student.birth_reg_no', 'text', '20130123456789012'),
  f('student.photo', 'image', 'photo'),
];

const DOC_TAIL: FieldDef[] = [
  f('print.copyLabel', 'text', 'Copy 2'),
  f('print.issue_date', 'text', '01 Jan 2027'),
  f('print.verify_qr', 'qr', 'https://example.com/verify/abc123'),
];

const CERT_TAIL: FieldDef[] = [
  f('print.serial_no', 'text', 'TSM-2026-00009', 'DAHS-TSM-2026-00009'),
  ...DOC_TAIL,
];

const EXAM: FieldDef[] = [
  f(
    'exam.name',
    'text',
    'Half-Yearly Examination 2026',
    'Half-Yearly Examination and Model Test 2026',
  ),
  f('exam.year', 'text', '2026'),
];

const ADMIT_SLOTS: FieldDef[] = Array.from(
  { length: ADMIT_CARD_SITTING_SLOTS },
  (_, i) => i + 1,
).flatMap((n) => [
  f(`exam.sitting.${n}.subject`, 'text', 'Mathematics', 'Information and Communication Technology'),
  f(`exam.sitting.${n}.date`, 'text', '01 Mar 2026'),
  f(`exam.sitting.${n}.time`, 'text', '10:00–13:00'),
  f(`exam.sitting.${n}.room`, 'text', 'Room 101'),
  f(`exam.sitting.${n}.seat`, 'text', 'A-12'),
]);

const RESULT: FieldDef[] = [
  ...EXAM,
  f('result.total_marks', 'text', '812'),
  f('result.gpa', 'text', '5.00'),
  f('result.grade', 'text', 'A+'),
  f('result.position', 'text', '3'),
];

const FINAL_RESULT: FieldDef[] = [
  f('final_result.year', 'text', '2026'),
  f('final_result.total', 'text', '812'),
  f('final_result.gpa', 'text', '5.00'),
  f('final_result.grade', 'text', 'A+'),
  f('final_result.position', 'text', '3'),
  f('final_result.section_position', 'text', '2'),
  f('attendance.working_days', 'text', '220'),
  f('attendance.present_days', 'text', '205'),
  f('report_card.remark', 'text', 'Good progress', 'A long remark about the student progress'),
];

export const FIELD_CATALOG: Record<DocumentKind, FieldDef[]> = {
  [DocumentKind.STUDENT_ID_CARD]: [
    ...SCHOOL,
    f('student.name', 'text', 'Mohammad Rahim Uddin', 'Mohammad Abdullah Al Mamun Rahim Uddin'),
    f(
      'student.name_bn',
      'text',
      'মোহাম্মদ রহিম উদ্দিন',
      'মোহাম্মদ আব্দুল্লাহ আল মামুন রহিম উদ্দিন',
    ),
    f('student.class', 'text', 'Class 8'),
    f('student.section', 'text', 'A'),
    f('student.roll', 'text', '12'),
    f('student.registration_number', 'text', '2027-000123'),
    f('student.blood_group', 'text', 'B+'),
    f('student.date_of_birth', 'text', '05 May 2013'),
    f('student.photo', 'image', 'photo'),
    f('guardian.phone', 'text', '01811-000000'),
    ...COMMON_TAIL,
  ],
  [DocumentKind.STAFF_ID_CARD]: [
    ...SCHOOL,
    f('staff.name', 'text', 'Fatema Begum', 'Mst. Fatema Khatun Begum Chowdhury'),
    f('staff.name_bn', 'text', 'ফাতেমা বেগম', 'মোছাঃ ফাতেমা খাতুন বেগম চৌধুরী'),
    f('staff.designation', 'text', 'Assistant Teacher', 'Senior Assistant Teacher (Mathematics)'),
    f('staff.employee_id', 'text', 'EMP-0042'),
    f('staff.blood_group', 'text', 'O+'),
    f('staff.phone', 'text', '01911-000000'),
    f('staff.photo', 'image', 'photo'),
    ...COMMON_TAIL,
  ],
  [DocumentKind.ACR_ASSESSMENT]: [
    ...SCHOOL,
    f('staff.name', 'text', 'Fatema Begum', 'Mst. Fatema Khatun Begum Chowdhury'),
    f('staff.name_bn', 'text', 'ফাতেমা বেগম', 'মোছাঃ ফাতেমা খাতুন বেগম চৌধুরী'),
    f('staff.designation', 'text', 'Assistant Teacher', 'Senior Assistant Teacher (Mathematics)'),
    f('acr.year', 'text', '2026'),
    f('acr.total', 'text', '82'),
    f('acr.completed_on', 'text', '31 Dec 2026'),
    ...ACR_CRITERIA,
    ...ACR_TAIL,
  ],
  [DocumentKind.EXAM_ADMIT_CARD]: [
    ...SCHOOL,
    ...STUDENT_DOC,
    ...EXAM,
    f('seat.room', 'text', 'Room 101'),
    f('seat.number', 'text', 'A-12'),
    ...ADMIT_SLOTS,
    ...DOC_TAIL,
  ],
  [DocumentKind.TRANSFER_CERTIFICATE]: [
    ...SCHOOL,
    ...STUDENT_DOC,
    f('student.admission_date', 'text', '01 Jan 2020'),
    f('leaving.date', 'text', '31 Dec 2026'),
    f('leaving.class', 'text', 'Class 8'),
    f('leaving.reason', 'text', 'Family relocation'),
    f('leaving.destination', 'text', 'Rajshahi Collegiate School'),
    issue('issue.conduct', 'Good', 120),
    issue('issue.remark', 'Nothing due', 200),
    ...CERT_TAIL,
  ],
  [DocumentKind.TESTIMONIAL]: [
    ...SCHOOL,
    ...STUDENT_DOC,
    f('public_exam.name', 'text', 'SSC'),
    f('public_exam.board', 'text', 'Dhaka'),
    f('public_exam.roll', 'text', '123456'),
    f('public_exam.registration', 'text', '1234567890'),
    f('public_exam.gpa', 'text', '5.00'),
    f('public_exam.year', 'text', '2026'),
    issue('issue.conduct', 'Good', 120),
    issue('issue.remark', 'Nothing due', 200),
    ...CERT_TAIL,
  ],
  [DocumentKind.CHARACTER_CERTIFICATE]: [
    ...SCHOOL,
    ...STUDENT_DOC,
    issue('issue.conduct', 'Good', 120),
    issue('issue.remark', 'Nothing due', 200),
    ...CERT_TAIL,
  ],
  [DocumentKind.STUDY_CERTIFICATE]: [
    ...SCHOOL,
    ...STUDENT_DOC,
    f('student.admission_date', 'text', '01 Jan 2020'),
    f('student.academic_year', 'text', '2026'),
    issue('issue.remark', 'Nothing due', 200),
    ...CERT_TAIL,
  ],
  [DocumentKind.PARTICIPATION_CERTIFICATE]: [
    ...SCHOOL,
    ...STUDENT_DOC,
    issue('issue.event_name', 'Annual Sports Day', 120),
    issue('issue.event_date', '26 Mar 2026', 40),
    issue('issue.remark', 'First place', 200),
    ...CERT_TAIL,
  ],
  [DocumentKind.RESULT_CERTIFICATE]: [
    ...SCHOOL,
    ...STUDENT_DOC,
    ...RESULT,
    ...FINAL_RESULT,
    ...CERT_TAIL,
  ],
  [DocumentKind.MERIT_CERTIFICATE]: [
    ...SCHOOL,
    ...STUDENT_DOC,
    ...RESULT,
    ...FINAL_RESULT,
    f('result.section_position', 'text', '2'),
    ...CERT_TAIL,
  ],
};
