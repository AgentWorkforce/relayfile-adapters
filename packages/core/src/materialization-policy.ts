export type AdapterMaterializationMode = 'lazy' | 'eager';

export interface AdapterMaterializationFilter<State extends string = string> {
  state?: State;
  labels?: string[];
  since?: string;
}

export interface AdapterResourceMaterializationPolicy<State extends string = string> {
  mode?: AdapterMaterializationMode;
  filter?: AdapterMaterializationFilter<State>;
  since?: string;
  incremental?: boolean;
}

export type AdapterMaterializationRule<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
> = {
  resources?: Resource[];
  filter?: AdapterMaterializationFilter<State>;
  since?: string;
  incremental?: boolean;
  eager?: boolean;
} & Partial<Record<Resource, AdapterMaterializationMode | AdapterResourceMaterializationPolicy<State>>>
  & Partial<Record<TargetKey, string[]>>;

export type AdapterMaterializationPolicy<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
> = {
  default?: AdapterMaterializationMode;
  rules?: Array<AdapterMaterializationRule<Resource, State, TargetKey>>;
} & Partial<Record<WebhookWritesKey, boolean>>;

export interface ResolvedResourceMaterialization<State extends string = string> {
  mode: AdapterMaterializationMode;
  filter?: AdapterMaterializationFilter<State>;
  since?: string;
}

export type ResolvedTargetMaterialization<
  Resource extends string,
  State extends string = string,
> = Record<Resource, ResolvedResourceMaterialization<State>>;

export interface NormalizeMaterializationPolicyOptions<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
> {
  defaultMode: AdapterMaterializationMode;
  fieldName?: string;
  preserveUndefined?: boolean;
  resourceListDescription?: string;
  resources: readonly Resource[];
  stateValues?: readonly State[];
  targetKey?: TargetKey;
  webhookWritesDefault?: boolean;
  webhookWritesKey?: WebhookWritesKey;
}

export interface ResolveMaterializationOptions<
  Resource extends string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
> {
  defaultMode?: AdapterMaterializationMode;
  resources: readonly Resource[];
  targetKey?: TargetKey;
  webhookWritesKey?: WebhookWritesKey;
}

export function normalizeMaterializationPolicy<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
>(
  value: unknown,
  options: NormalizeMaterializationPolicyOptions<Resource, State, TargetKey, WebhookWritesKey>,
): AdapterMaterializationPolicy<Resource, State, TargetKey, WebhookWritesKey> {
  const fieldName = options.fieldName ?? 'materialization';
  const webhookWritesKey = options.webhookWritesKey ?? ('webhookWritesForLazyTargets' as WebhookWritesKey);
  if (value === undefined) {
    return {
      default: options.defaultMode,
      [webhookWritesKey]: options.webhookWritesDefault ?? true,
    } as AdapterMaterializationPolicy<Resource, State, TargetKey, WebhookWritesKey>;
  }

  const policy = requirePlainObject(value, fieldName);
  return {
    default: requireMaterializationMode(policy.default ?? options.defaultMode, `${fieldName}.default`),
    [webhookWritesKey]: requireBoolean(
      policy[webhookWritesKey] ?? options.webhookWritesDefault ?? true,
      `${fieldName}.${webhookWritesKey}`,
    ),
    rules: policy.rules === undefined
      ? undefined
      : requireMaterializationRules(policy.rules, fieldName, options),
  } as AdapterMaterializationPolicy<Resource, State, TargetKey, WebhookWritesKey>;
}

export function resolveTargetMaterialization<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
>(
  policy: AdapterMaterializationPolicy<Resource, State, TargetKey, WebhookWritesKey> | undefined,
  target: string,
  syncOptions: { cursor?: string } = {},
  options: ResolveMaterializationOptions<Resource, TargetKey, WebhookWritesKey>,
): ResolvedTargetMaterialization<Resource, State> {
  const plan = {} as ResolvedTargetMaterialization<Resource, State>;
  for (const resource of options.resources) {
    plan[resource] = resolveResourceMaterialization(policy, target, resource, syncOptions, options);
  }
  return plan;
}

export function shouldWriteWebhookForTarget<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
>(
  policy: AdapterMaterializationPolicy<Resource, State, TargetKey, WebhookWritesKey> | undefined,
  target: string,
  options: ResolveMaterializationOptions<Resource, TargetKey, WebhookWritesKey>,
): boolean {
  const webhookWritesKey = options.webhookWritesKey ?? ('webhookWritesForLazyTargets' as WebhookWritesKey);
  if (policy?.[webhookWritesKey] !== false) {
    return true;
  }

  const plan = resolveTargetMaterialization(policy, target, {}, options);
  return options.resources.some((resource) => plan[resource].mode === 'eager');
}

export function matchesMaterializationTarget(pattern: string, target: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) {
    return false;
  }

  const normalizedTarget = target.toLowerCase();
  if (!normalizedPattern.includes('*') && !normalizedPattern.includes('?')) {
    return normalizedPattern === normalizedTarget;
  }

  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return regex.test(normalizedTarget);
}

function requireMaterializationRules<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
>(
  value: unknown,
  fieldName: string,
  options: NormalizeMaterializationPolicyOptions<Resource, State, TargetKey, WebhookWritesKey>,
): Array<AdapterMaterializationRule<Resource, State, TargetKey>> {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName}.rules must be an array`);
  }

  return value.map((rule, index) =>
    requireMaterializationRule(rule, `${fieldName}.rules[${index}]`, options),
  );
}

function requireMaterializationRule<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
>(
  value: unknown,
  fieldName: string,
  options: NormalizeMaterializationPolicyOptions<Resource, State, TargetKey, WebhookWritesKey>,
): AdapterMaterializationRule<Resource, State, TargetKey> {
  const rule = requirePlainObject(value, fieldName);
  const normalized: Record<string, unknown> = {
    resources: rule.resources === undefined
      ? undefined
      : requireMaterializationResources(rule.resources, `${fieldName}.resources`, options.resources),
    filter: rule.filter === undefined
      ? undefined
      : requireMaterializationFilter(rule.filter, `${fieldName}.filter`, options.stateValues),
    since: rule.since === undefined ? undefined : requireNonEmptyString(rule.since, `${fieldName}.since`),
    incremental: rule.incremental === undefined
      ? undefined
      : requireBoolean(rule.incremental, `${fieldName}.incremental`),
    eager: rule.eager === undefined ? undefined : requireBoolean(rule.eager, `${fieldName}.eager`),
  };

  const targetKey = options.targetKey ?? ('targets' as TargetKey);
  normalized[targetKey] = rule[targetKey] === undefined
    ? undefined
    : requireStringArray(rule[targetKey], `${fieldName}.${targetKey}`);

  for (const resource of options.resources) {
    normalized[resource] = rule[resource] === undefined
      ? undefined
      : requireResourceMaterializationPolicy(rule[resource], `${fieldName}.${resource}`, options.stateValues);
  }

  return (
    options.preserveUndefined
      ? normalized
      : Object.fromEntries(Object.entries(normalized).filter(([, next]) => next !== undefined))
  ) as AdapterMaterializationRule<Resource, State, TargetKey>;
}

function requireResourceMaterializationPolicy<State extends string = string>(
  value: unknown,
  fieldName: string,
  stateValues?: readonly State[],
): AdapterMaterializationMode | AdapterResourceMaterializationPolicy<State> {
  if (typeof value === 'string') {
    return requireMaterializationMode(value, fieldName);
  }

  const policy = requirePlainObject(value, fieldName);
  return {
    mode: policy.mode === undefined ? undefined : requireMaterializationMode(policy.mode, `${fieldName}.mode`),
    filter: policy.filter === undefined
      ? undefined
      : requireMaterializationFilter(policy.filter, `${fieldName}.filter`, stateValues),
    since: policy.since === undefined ? undefined : requireNonEmptyString(policy.since, `${fieldName}.since`),
    incremental: policy.incremental === undefined
      ? undefined
      : requireBoolean(policy.incremental, `${fieldName}.incremental`),
  };
}

function requireMaterializationFilter<State extends string = string>(
  value: unknown,
  fieldName: string,
  stateValues?: readonly State[],
): AdapterMaterializationFilter<State> {
  const filter = requirePlainObject(value, fieldName);
  return {
    state: filter.state === undefined ? undefined : requireState(filter.state, `${fieldName}.state`, stateValues),
    labels: filter.labels === undefined ? undefined : requireStringArray(filter.labels, `${fieldName}.labels`),
    since: filter.since === undefined ? undefined : requireNonEmptyString(filter.since, `${fieldName}.since`),
  };
}

function requireMaterializationResources<Resource extends string>(
  value: unknown,
  fieldName: string,
  allowedResources: readonly Resource[],
): Resource[] {
  const allowed = new Set<Resource>(allowedResources);
  return requireStringArray(value, fieldName).map((resource, index) => {
    if (!allowed.has(resource as Resource)) {
      const description = allowedResources.length === 2
        ? `"${allowedResources[0]}" or "${allowedResources[1]}"`
        : `one of: ${allowedResources.join(', ')}`;
      throw new Error(`${fieldName}[${index}] must be ${description}`);
    }
    return resource as Resource;
  });
}

function requireMaterializationMode(value: unknown, fieldName: string): AdapterMaterializationMode {
  const mode = requireNonEmptyString(value, fieldName);
  if (mode === 'lazy' || mode === 'none') {
    return 'lazy';
  }
  if (mode === 'eager' || mode === 'all') {
    return 'eager';
  }
  throw new Error(`${fieldName} must be "lazy" or "eager"`);
}

function requireState<State extends string>(
  value: unknown,
  fieldName: string,
  allowedStates?: readonly State[],
): State {
  const state = requireNonEmptyString(value, fieldName) as State;
  if (allowedStates && !allowedStates.includes(state)) {
    throw new Error(`${fieldName} must be one of: ${allowedStates.join(', ')}`);
  }
  return state;
}

function resolveResourceMaterialization<
  Resource extends string,
  State extends string = string,
  TargetKey extends string = 'targets',
  WebhookWritesKey extends string = 'webhookWritesForLazyTargets',
>(
  policy: AdapterMaterializationPolicy<Resource, State, TargetKey, WebhookWritesKey> | undefined,
  target: string,
  resource: Resource,
  syncOptions: { cursor?: string },
  options: ResolveMaterializationOptions<Resource, TargetKey, WebhookWritesKey>,
): ResolvedResourceMaterialization<State> {
  const defaultMode = policy?.default ?? options.defaultMode ?? 'eager';
  const targetKey = options.targetKey ?? ('targets' as TargetKey);
  const rule = policy?.rules?.find((candidate) => matchesRuleTarget(candidate, targetKey, target));

  if (!rule) {
    return { mode: defaultMode };
  }

  const resourcePolicy = normalizeResourcePolicy(rule[resource]);
  const mode =
    resourcePolicy?.mode ??
    modeFromResourceList(rule, resource) ??
    (typeof rule.eager === 'boolean' ? (rule.eager ? 'eager' : 'lazy') : defaultMode);
  const filter = resourcePolicy?.filter ?? rule.filter;
  const since = resourcePolicy?.since
    ?? filter?.since
    ?? rule.since
    ?? (resourcePolicy?.incremental || rule.incremental ? syncOptions.cursor : undefined);

  return {
    mode,
    filter,
    since,
  };
}

function normalizeResourcePolicy<State extends string = string>(
  value: AdapterMaterializationMode | AdapterResourceMaterializationPolicy<State> | undefined,
): AdapterResourceMaterializationPolicy<State> | undefined {
  if (!value) {
    return undefined;
  }
  return typeof value === 'string' ? { mode: value } : value;
}

function modeFromResourceList<Resource extends string, State extends string, TargetKey extends string>(
  rule: AdapterMaterializationRule<Resource, State, TargetKey>,
  resource: Resource,
): AdapterMaterializationMode | undefined {
  if (!rule.resources) {
    return undefined;
  }
  return rule.resources.includes(resource) ? 'eager' : 'lazy';
}

function matchesRuleTarget<Resource extends string, State extends string, TargetKey extends string>(
  rule: AdapterMaterializationRule<Resource, State, TargetKey>,
  targetKey: TargetKey,
  target: string,
): boolean {
  const patterns = rule[targetKey];
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => matchesMaterializationTarget(pattern, target));
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }
  return value.map((item, index) => requireNonEmptyString(item, `${fieldName}[${index}]`));
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

function requirePlainObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}
