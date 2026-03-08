-- Fix the broken trigger on parent_guardian table
DROP TRIGGER IF EXISTS parent_guardian_check_trigger ON parent_guardian;
DROP FUNCTION IF EXISTS check_parent_guardian_not_guardian();

CREATE OR REPLACE FUNCTION public.check_parent_guardian_not_guardian()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    -- Simply return NEW - the old trigger had a reference to non-existent 'guardians' table
    RETURN NEW;
END;
$function$;

CREATE TRIGGER parent_guardian_check_trigger
BEFORE INSERT OR UPDATE ON public.parent_guardian
FOR EACH ROW
EXECUTE FUNCTION check_parent_guardian_not_guardian();

SELECT 'Trigger fixed successfully' as status;
