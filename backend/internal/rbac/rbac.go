package rbac

const (
	RoleUser  = "user"
	RoleAdmin = "admin"
)

var rolePerms = map[string][]string{
	RoleUser:  {"lookup:user", "update:self", "call:initiate", "contact:manage"},
	RoleAdmin: {"lookup:user", "update:self", "call:initiate", "contact:manage", "manage:lockdown", "view:audit", "manage:users"},
}

func HasPermission(role, perm string) bool {
	for _, p := range rolePerms[role] {
		if p == perm {
			return true
		}
	}
	return false
}