const FEMALE_FIRST_NAMES = [
  'Maria', 'Ana', 'Angela', 'Andrea', 'Bea', 'Bianca', 'Carla', 'Clarisse',
  'Cristina', 'Danica', 'Diana', 'Elaine', 'Eliza', 'Faith', 'Gabriela', 'Grace',
  'Hannah', 'Hazel', 'Irene', 'Isabel', 'Janelle', 'Janine', 'Jasmine', 'Joanna',
  'Joy', 'Karen', 'Kathleen', 'Kristine', 'Lara', 'Leah', 'Lorraine', 'Louise',
  'Mae', 'Mariel', 'Mikaela', 'Nadine', 'Nicole', 'Patricia', 'Princess', 'Rachel',
  'Rica', 'Rina', 'Riza', 'Samantha', 'Shaira', 'Sheila', 'Sophia', 'Therese',
  'Vanessa', 'Yna',
];

const MALE_FIRST_NAMES = [
  'Adrian', 'Albert', 'Aldrin', 'Alex', 'Alvin', 'Andrei', 'Anthony', 'Arvin',
  'Benjo', 'Bryan', 'Carlo', 'Cedric', 'Christian', 'Christopher', 'Daniel', 'David',
  'Dennis', 'Dominic', 'Edgar', 'Emmanuel', 'Eric', 'Francis', 'Gabriel', 'Gerald',
  'Harold', 'Ian', 'Isaac', 'Jasper', 'Jerome', 'John Paul', 'Joshua', 'Jun',
  'Kevin', 'Lawrence', 'Lester', 'Luis', 'Mark', 'Michael', 'Nathaniel', 'Noel',
  'Patrick', 'Paulo', 'Ralph', 'Raymond', 'Renzo', 'Ryan', 'Samuel', 'Vincent',
  'Warren', 'Xavier',
];

const MIDDLE_NAMES = [
  'Abad', 'Aguilar', 'Aquino', 'Bautista', 'Castillo', 'Cruz', 'Dela Cruz', 'Delos Santos',
  'Domingo', 'Enriquez', 'Evangelista', 'Fernandez', 'Garcia', 'Gonzales', 'Hernandez',
  'Labrador', 'Lim', 'Lopez', 'Magsino', 'Mendoza', 'Morales', 'Natividad', 'Ocampo',
  'Panganiban', 'Pascual', 'Ramos', 'Reyes', 'Rivera', 'Santiago', 'Soriano',
];

const LAST_NAMES = [
  'Abalos', 'Aquino', 'Bacani', 'Bautista', 'Bernardo', 'Cabrera', 'Castillo', 'Cruz',
  'Dela Cruz', 'Del Rosario', 'Diaz', 'Domingo', 'Evangelista', 'Fernandez', 'Flores',
  'Garcia', 'Gonzales', 'Guerrero', 'Hernandez', 'Labrador', 'Lim', 'Lopez', 'Mabini',
  'Magsaysay', 'Manalo', 'Mendoza', 'Mercado', 'Navarro', 'Nolasco', 'Ocampo',
  'Panganiban', 'Pascual', 'Ramos', 'Reyes', 'Rivera', 'Robles', 'Santos', 'Soriano',
  'Tan', 'Torres', 'Valdez', 'Velasco', 'Villanueva', 'Yap', 'Zamora',
];

const PASIG_BARANGAYS = [
  'San Nicolas', 'Bagong Ilog', 'Bambang', 'Caniogan', 'Kapitolyo', 'Kalawaan',
  'Manggahan', 'Maybunga', 'Oranbo', 'Palatiw', 'Pinagbuhatan', 'Pineda',
  'Rosario', 'San Antonio', 'Santolan', 'Ugong',
];

const STREET_NAMES = [
  'Mabini', 'Bonifacio', 'Luna', 'Rizal', 'Katipunan', 'Jasmin', 'Sampaguita',
  'Rosal', 'Acacia', 'Ilang-Ilang', 'Narra', 'Molave', 'Mahogany', 'Camia',
  'Palmera', 'Manga', 'Guyabano', 'Dahlia', 'Ampalaya', 'Manggis',
];

const SUBDIVISIONS = [
  'Villa Verde', 'Green Meadows', 'Riverside Homes', 'Sunrise Village',
  'Mabuhay Park', 'San Roque Homes', 'Sampaguita Residences', 'Bayanihan Heights',
  'Sta. Lucia Homes', 'Golden Fields',
];

const PLACE_OF_BIRTHS = [
  'San Nicolas Community Birthing Center',
  'Pasig Family Wellness Hospital',
  'Metro East Women and Children Clinic',
  'Sta. Clara Maternity Care Center',
  'Riverside Infant Wellness Hospital',
];

const ANNOUNCEMENT_TEMPLATES = [
  {
    title: 'EPI Catch-up Vaccination Drive',
    content:
      'Catch-up immunization sessions are available every Wednesday and Friday at San Nicolas Health Center. Bring your child health booklet and arrive 15 minutes early.',
    priority: 'high',
    target_audience: 'all',
  },
  {
    title: 'Cold Chain Inventory Review',
    content:
      'Inventory personnel are scheduled for end-of-month stock reconciliation and FEFO review. Please verify batch numbers and expiry dates before final submission.',
    priority: 'medium',
    target_audience: 'all',
  },
  {
    title: 'Guardian Portal Reminder',
    content:
      'Guardians are encouraged to update contact numbers and notification preferences to continue receiving appointment reminders and vaccination alerts.',
    priority: 'medium',
    target_audience: 'patients',
  },
  {
    title: 'MR and MMR Follow-up Session',
    content:
      'Children due for MR and MMR doses may attend the Saturday follow-up session. Walk-ins are accepted subject to vaccine availability.',
    priority: 'high',
    target_audience: 'patients',
  },
  {
    title: 'Monthly Accomplishment Report Window',
    content:
      'All monthly utilization and stock reports must be reviewed before the fifth working day of the succeeding month.',
    priority: 'low',
    target_audience: 'all',
  },
];

const MESSAGE_SUBJECTS = [
  'Appointment Follow-up',
  'Vaccination Schedule Clarification',
  'Stock Availability Concern',
  'Transfer-in Case Update',
  'Reminder Preference Update',
  'Document Follow-up',
];

const MESSAGE_BODIES = [
  'The health center has reviewed the recent record and updated the next recommended visit.',
  'Please review the revised appointment details in the portal before your next clinic visit.',
  'A staff member has confirmed the stock allocation for your scheduled immunization session.',
  'Your request has been endorsed to the assigned nurse for follow-up validation.',
  'The clinic uploaded a new update related to your child vaccination record.',
  'We recorded your latest clinic visit and linked the outcome to your child profile.',
];

const REPORT_TYPES = [
  'inventory',
  'vaccination',
  'demographics',
  'appointments',
  'guardian-engagement',
];

module.exports = {
  FEMALE_FIRST_NAMES,
  MALE_FIRST_NAMES,
  MIDDLE_NAMES,
  LAST_NAMES,
  PASIG_BARANGAYS,
  STREET_NAMES,
  SUBDIVISIONS,
  PLACE_OF_BIRTHS,
  ANNOUNCEMENT_TEMPLATES,
  MESSAGE_SUBJECTS,
  MESSAGE_BODIES,
  REPORT_TYPES,
};
