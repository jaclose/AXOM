import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import { createCommunicationsHandler } from "./service.js";
const env = Deno.env.toObject();
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createCommunicationsHandler(db, env));
