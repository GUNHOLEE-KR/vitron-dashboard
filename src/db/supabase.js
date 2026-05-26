import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://dwgyelenymwzlkfuvcbz.supabase.co'
const SUPABASE_KEY = 'sb_publishable_elg9-sz1fSLw7uAl0XsBxw_6XnrOdRW'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
