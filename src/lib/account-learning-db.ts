import { supabase } from "@/integrations/supabase/client";

export function accountLearningDb() {
  return supabase;
}
