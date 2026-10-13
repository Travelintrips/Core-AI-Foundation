# Categorize diagnostic messages without printing raw log payloads.
def classify:
  tostring as $msg |
  if ($msg | test("EADDRINUSE|listen|port already";"i")) then "port_or_listener"
  elif ($msg | test("ECONNREFUSED|ETIMEDOUT|database|postgres|supabase|redis";"i")) then "dependency_connection"
  elif ($msg | test("MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module";"i")) then "missing_module"
  elif ($msg | test("uncaught|unhandled|fatal|exception|error";"i")) then "runtime_error"
  else "other" end;

(if (.logs | type) == "array" then .logs
 elif (.data | type) == "object" and (.data.logs | type) == "array" then .data.logs
 else [] end) as $entries |
{runtime_log_categories:
  ([ $entries[-30:][]? |
    ((if type == "object" then (.message // .text // "") else "" end) | classify)
   ] | group_by(.) | map({category: .[0], count: length}))}
