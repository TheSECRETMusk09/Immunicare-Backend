# Guardian Test Login Credentials

# Use these credentials to test the guardian login functionality on the webpage

## Login Portal: http://localhost:3000/guardian-login

### Guardian Accounts (with linked patients)

1. **Maria Elena Santos** (Parent of Sofia Santos)
   - Email: maria.santos@email.com
   - Password: guardian123
   - Linked Patient: Sofia Santos (DOB: 2024-06-15, F)
   - Address: 123 Sampaguita Street, Barangay Maliksi, Quezon City

2. **Juan Miguel dela Cruz** (Guardian of Mateo Santos)
   - Email: juan.delacruz@email.com
   - Password: guardian123
   - Linked Patient: Mateo Santos (DOB: 2024-08-20, M)
   - Address: 456 Rose Avenue, Barangay Santol, Manila

3. **Ana Marie Reyes** (Parent of Isabella dela Cruz)
   - Email: ana.reyes@email.com
   - Password: guardian123
   - Linked Patient: Isabella dela Cruz (DOB: 2024-03-10, F)
   - Address: 789 Lily Lane, Barangay Holy Spirit, Quezon City

4. **Pedro Luis Garcia** (Parent of Gabriel Reyes)
   - Email: pedro.garcia@email.com
   - Password: guardian123
   - Linked Patient: Gabriel Reyes (DOB: 2024-09-05, M)
   - Address: 321 Jasmine Road, Barangay San Antonio, Makati

5. **Carmen Victoria Lim** (Guardian of Camila Garcia)
   - Email: carmen.lim@email.com
   - Password: guardian123
   - Linked Patient: Camila Garcia (DOB: 2024-07-22, F)
   - Address: 654 Orchid Street, Barangay Bel-Air, Makati

## Database Information

### Tables Updated:

- **parent_guardian**: Now includes `password_hash` and `is_password_set` columns
- **infants**: Linked to guardians via `guardian_id` foreign key

### Password Security:

- Passwords are hashed using bcrypt with salt
- Password hash stored in `password_hash` column
- `is_password_set` flag indicates if password has been set

## Testing Steps

1. Go to http://localhost:3000/guardian-login
2. Enter any of the email/password combinations above
3. Login to access the guardian dashboard

## Seed Script

Run `node backend/seed_data.js` to re-seed the data with fresh guardians and patients.
