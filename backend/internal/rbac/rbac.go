package rbac

const (
	RoleGuest      = "guest"
	RoleUser       = "user"
	RoleAppUser    = "app_user"
	RoleAdmin      = "admin"
	RoleSuperAdmin = "super_admin"
)

var rolePerms = map[string][]string{
	RoleGuest:      {"call:initiate", "call:join_link"},
	RoleUser:       {"lookup:user", "update:self", "call:initiate", "contact:manage"},
	RoleAppUser:    {"lookup:user", "update:self", "call:initiate", "contact:manage"},
	RoleAdmin:      {"lookup:user", "update:self", "call:initiate", "contact:manage", "manage:lockdown", "view:audit", "manage:users"},
	RoleSuperAdmin: {"lookup:user", "update:self", "call:initiate", "contact:manage", "manage:lockdown", "view:audit", "manage:users"},
}

func HasPermission(role, perm string) bool {
	for _, p := range rolePerms[role] {
		if p == perm {
			return true
		}
	}
	return false
}
