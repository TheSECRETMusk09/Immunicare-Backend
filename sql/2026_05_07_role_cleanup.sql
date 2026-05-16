DO $$
DECLARE
  v_hw_id        int;
  v_hcw_id       int;
  v_inv_id       int;
  v_cm_id        int;
  v_den_id       int;
  v_nut_id       int;
  v_inv_users    int := 0;
  v_cm_users     int := 0;
  v_den_users    int := 0;
  v_nut_users    int := 0;
BEGIN

  SELECT id INTO v_hw_id  FROM roles WHERE lower(name) = 'health_worker'     LIMIT 1;
  SELECT id INTO v_hcw_id FROM roles WHERE lower(name) = 'healthcare_worker' LIMIT 1;
  SELECT id INTO v_inv_id FROM roles WHERE lower(name) = 'inventory_manager' LIMIT 1;
  SELECT id INTO v_cm_id  FROM roles WHERE lower(name) = 'clinic_manager'    LIMIT 1;
  SELECT id INTO v_den_id FROM roles WHERE lower(name) = 'dentist'           LIMIT 1;
  SELECT id INTO v_nut_id FROM roles WHERE lower(name) = 'nutritionist'      LIMIT 1;

  IF v_hw_id IS NOT NULL THEN
    IF v_hcw_id IS NULL THEN
      UPDATE roles
         SET name         = 'healthcare_worker',
             display_name = 'Health Care Worker',
             updated_at   = NOW()
       WHERE id = v_hw_id;
      RAISE NOTICE 'Renamed role health_worker (id=%) to healthcare_worker', v_hw_id;
    ELSE
      UPDATE users SET role_id = v_hcw_id WHERE role_id = v_hw_id;
      DELETE FROM roles WHERE id = v_hw_id;
      RAISE NOTICE 'Merged health_worker (id=%) into existing healthcare_worker (id=%)', v_hw_id, v_hcw_id;
    END IF;
  ELSE
    RAISE NOTICE 'health_worker role not found – skipping rename';
  END IF;

  IF v_inv_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_inv_users FROM users WHERE role_id = v_inv_id;
    IF v_inv_users = 0 THEN
      DELETE FROM roles WHERE id = v_inv_id;
      RAISE NOTICE 'Removed inventory_manager role (id=%)', v_inv_id;
    ELSE
      RAISE WARNING 'inventory_manager has % user(s) – NOT removed. Reassign them first.', v_inv_users;
    END IF;
  END IF;

  IF v_cm_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_cm_users FROM users WHERE role_id = v_cm_id;
    IF v_cm_users = 0 THEN
      DELETE FROM roles WHERE id = v_cm_id;
      RAISE NOTICE 'Removed clinic_manager role (id=%)', v_cm_id;
    ELSE
      RAISE WARNING 'clinic_manager has % user(s) – NOT removed. Reassign them first.', v_cm_users;
    END IF;
  END IF;

  IF v_den_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_den_users FROM users WHERE role_id = v_den_id;
    IF v_den_users = 0 THEN
      DELETE FROM roles WHERE id = v_den_id;
      RAISE NOTICE 'Removed dentist role (id=%)', v_den_id;
    ELSE
      RAISE WARNING 'dentist has % user(s) – NOT removed. Reassign them first.', v_den_users;
    END IF;
  END IF;

  IF v_nut_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_nut_users FROM users WHERE role_id = v_nut_id;
    IF v_nut_users = 0 THEN
      DELETE FROM roles WHERE id = v_nut_id;
      RAISE NOTICE 'Removed nutritionist role (id=%)', v_nut_id;
    ELSE
      RAISE WARNING 'nutritionist has % user(s) – NOT removed. Reassign them first.', v_nut_users;
    END IF;
  END IF;

END $$;
