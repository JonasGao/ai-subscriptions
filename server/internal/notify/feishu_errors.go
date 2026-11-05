package notify

// Feishu scopes and error translation, ported from
// lib/notifications/feishu-permissions.ts and feishu-errors.ts.
//
// The scope registry is the single source of truth: the settings page renders
// the same list the error translator cites, so a missing scope surfaces the
// name the user must enable in the Feishu console instead of a raw error code.

import (
	"fmt"
	"regexp"
	"strings"
)

// FeishuPermission is one scope the feishu-app channel needs.
type FeishuPermission struct {
	Scope   string
	Name    string
	Purpose string
	UsedBy  []string
}

// FeishuPermissions is the canonical scope list, in the recommended setup
// order: sending → discovery → user lookup → events.
var FeishuPermissions = []FeishuPermission{
	{
		Scope:   "im:message:send_as_bot",
		Name:    "以应用身份发送消息",
		Purpose: "允许机器人向用户或群组发送消息( interactive 卡片 / 文本等)",
		UsedBy:  []string{"发送通知消息"},
	},
	{
		Scope:   "im:chat:readonly",
		Name:    "获取群组信息",
		Purpose: "读取机器人所在的群列表,用于在设置页「从群列表选择」辅助填入 chat_id",
		UsedBy:  []string{"辅助获取 Receive ID - 群列表"},
	},
	{
		Scope:   "contact:user.id:readonly",
		Name:    "获取用户 userID",
		Purpose: "通过手机号反查用户的 open_id,用于在设置页「手机号查询」辅助填入 receive_id",
		UsedBy:  []string{"辅助获取 Receive ID - 手机号反查"},
	},
	{
		Scope:   "im:message.p2p_msg:readonly",
		Name:    "读取用户发给机器人的单聊消息",
		Purpose: "订阅 im.message.receive_v1 事件,接收用户与机器人的 1-on-1 聊天消息,用于在设置页「通过消息获取」辅助取得 open_id",
		UsedBy:  []string{"长连接监听 - 单聊消息"},
	},
	{
		Scope:   "im:message.group_at_msg:readonly",
		Name:    "读取群组中 @机器人的消息",
		Purpose: "订阅 im.message.receive_v1 事件,接收群内 @机器人 的消息,用于在设置页「通过消息获取」辅助取得 open_id",
		UsedBy:  []string{"长连接监听 - 群聊 @消息"},
	},
}

// FeishuListenEventKey is the event the WS listener subscribes to.
const FeishuListenEventKey = "im.message.receive_v1"

// AllScopeNames joins every required scope, as the error hints render them.
func AllScopeNames() string {
	names := make([]string, 0, len(FeishuPermissions))
	for _, permission := range FeishuPermissions {
		names = append(names, permission.Scope)
	}
	return strings.Join(names, ", ")
}

// FindPermissionByScope returns the registry entry for scope, if any.
func FindPermissionByScope(scope string) (FeishuPermission, bool) {
	for _, permission := range FeishuPermissions {
		if permission.Scope == scope {
			return permission, true
		}
	}
	return FeishuPermission{}, false
}

var scopePattern = regexp.MustCompile(`(?i)scope[s]?:\s*([a-zA-Z0-9_:.,\s]+)`)
var scopeSplitter = regexp.MustCompile(`[,\s]+`)

// TranslateFeishuError maps a verified Feishu error code to a human-readable
// message. ok is false for codes outside the documented set, which callers
// surface raw.
func TranslateFeishuError(code int, msg string) (string, bool) {
	switch code {
	case 99991663:
		return "app_access_token 无效或已过期,请检查 App ID 和 App Secret", true
	case 99991664:
		return "tenant_access_token 无效或已过期,请重新获取", true
	case 99991665:
		return "tenant_access_token 格式错误或权限不足", true
	case 99991668:
		return "tenant_access_token 已过期,请刷新", true
	case 99991400:
		return "权限不足,请在飞书开放平台为应用开通相应权限(所需权限: " + AllScopeNames() + ")", true
	case 99991672:
		return parseScopeError(msg), true
	default:
		return "", false
	}
}

// parseScopeError pulls the missing scope names out of a 99991672 message and
// annotates the ones the registry knows about.
func parseScopeError(msg string) string {
	fallback := "权限不足,请在飞书开放平台为应用开通相应权限(所需权限: " + AllScopeNames() + ")"
	if msg == "" {
		return fallback
	}
	match := scopePattern.FindStringSubmatch(msg)
	if match == nil {
		return "权限不足: " + msg
	}
	resolved := make([]string, 0, 4)
	for _, raw := range scopeSplitter.Split(match[1], -1) {
		scope := strings.TrimSpace(raw)
		if scope == "" {
			continue
		}
		if permission, found := FindPermissionByScope(scope); found {
			resolved = append(resolved, fmt.Sprintf("%s(%s)", scope, permission.Name))
		} else {
			resolved = append(resolved, scope)
		}
	}
	if len(resolved) == 0 {
		return fallback
	}
	return "权限不足,需要开通以下权限: " + strings.Join(resolved, ", ")
}

// FeishuAPIError is a Feishu API failure with the translated message plus the
// raw code/msg, so logs keep the code while the UI reads the hint.
type FeishuAPIError struct {
	Code    int
	Msg     string
	Context string
	Message string
}

func (e *FeishuAPIError) Error() string { return e.Message }

// NewFeishuAPIError builds the displayable error for a Feishu failure.
func NewFeishuAPIError(code int, msg, context string) error {
	translated, known := TranslateFeishuError(code, msg)
	prefix := ""
	if context != "" {
		prefix = context + ": "
	}

	var full string
	if known {
		full = prefix + translated
		// Scope errors already embed the raw msg; other codes append it.
		if code != 99991672 && msg != "" && !strings.Contains(translated, msg) {
			full += fmt.Sprintf(" (详情: %s)", msg)
		}
	} else if msg != "" {
		full = fmt.Sprintf("%s飞书 API 错误(code=%d): %s。请在飞书开放平台文档中查阅此错误码。", prefix, code, msg)
	} else {
		full = fmt.Sprintf("%s飞书 API 错误: code=%d。请在飞书开放平台文档中查阅此错误码。", prefix, code)
	}

	return &FeishuAPIError{Code: code, Msg: msg, Context: context, Message: full}
}
