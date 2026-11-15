export type Verdict = "PASS" | "FAIL" | "VERIFY" | "NOT_MEASURED";
export interface Twin {
  property_id?: string | null;
  model_id?: string | null;
  location_id?: string | null;
  execution_site?: "local_fixture" | "property_site" | null;
  verified?: boolean;
  verification_notes?: string;
  source_inspection_id?: string | null;
  width_uncertainty_in?: number | null;
  running_slope_uncertainty_deg?: number | null;
  cross_slope_uncertainty_deg?: number | null;
  id: string;
  name: string;
  location: string;
  source: string;
  source_reference: string;
  width_in: number;
  running_slope_deg: number | null;
  cross_slope_deg: number | null;
  captured_at: string;
}
export interface Point {
  angle_deg: number;
  distance_cm: number | null;
  spread_cm: number;
  valid_pings: number;
}
export interface Check {
  key: string;
  label: string;
  value: number | null;
  error: number;
  minimum: number | null;
  maximum: number | null;
  unit: string;
  status: Verdict;
  section: string;
  source: string;
}
export interface Result {
  verdict: Verdict;
  checks: Check[];
  width_cm: number | null;
  width_in: number | null;
  running_slope_deg: number | null;
  cross_slope_deg: number | null;
  issues: string[];
  drift: {
    key: string;
    label: string;
    measured: number | null;
    expected: number | null;
    combined_uncertainty?: number | null;
    comparison_status?: string;
    delta: number | null;
    unit: string;
    changed: boolean;
  }[];
  noisy_angles: number[];
  scope: string;
  limitations: string[];
  rule_version: string;
}
export interface Diagnosis {
  inspection_profile?: string;
  capture_trigger_checks?: string[];
  obstruction_status?:
    "obstruction" | "expected_structure" | "uncertain" | "none";
  path_relation?: string;
  intrusion_evidence?: string;
  object_type?: string;
  obstruction: string;
  classification: string;
  confidence: number;
  observations: string[];
  recommendations: string[];
  limitations: string;
  provider: string;
  cloud_vision_status: string;
  objects: { name: string; confidence: number }[];
}
export interface WorkOrder {
  id: string;
  status: string;
  assignee: string;
  notes: string;
  summary: string;
  cost_note: string;
  actions: {
    title: string;
    detail: string;
    priority: string;
    estimate_low: number | null;
    estimate_high: number | null;
    rule: string;
  }[];
}
export interface SponsorContext {
  property_address?: string;
  evidence_provenance?: Record<string, unknown>;
  review_id: string;
  plan_id: string;
  property_id: string;
  property_name: string;
  model_id: string;
  action_index: number;
  target_location: string;
  title: string;
  reason: string;
  next_action: string;
  sources: string[];
  execution_site: "local_fixture" | "property_site";
}
export interface Scan {
  baseline_used?: boolean;
  history_scope?: { building_id: string; location_id: string };
  sponsor_context?: SponsorContext | null;
  atlas_status?: "saving" | "saved" | "failed";
  atlas_error?: string;
  atlas_inspection_id?: string;
  id: string;
  created_at: string;
  completed_at?: string;
  status: string;
  request: {
    mode: string;
    scenario: string;
    profile: string;
    building_id: string;
    location_id?: string;
    use_ai: boolean;
  };
  twin: Twin;
  points: Point[];
  tilt?: { pitch_deg: number; roll_deg: number; still: boolean };
  result?: Result;
  images: { id: string; url: string; angle_deg: number; simulated: boolean }[];
  diagnosis?: Diagnosis;
  work_order?: WorkOrder;
  agent_provider: string;
  error?: string;
  ai_error?: string;
  warnings?: string[];
}
export interface Event {
  id: number;
  created_at: string;
  kind: string;
  data: Record<string, unknown>;
}
export interface Settings {
  matterport_api_key_configured?: boolean;
  matterport_api_token_configured?: boolean;
  matterport_sdk_key_configured?: boolean;
  vexcel_api_key_configured?: boolean;
  gemini_api_key_configured: boolean;
  google_vision_api_key_configured: boolean;
  gemini_model: string;
  serial_port: string;
  camera_index: number;
  turret_offset_cm: number;
  alignment_deg: number;
  pitch_bias_deg: number;
  roll_bias_deg: number;
  width_error_cm: number;
  slope_error_deg: number;
  calibration_verified: boolean;
  button_enabled: boolean;
  button_building_id: string;
  button_profile: string;
  button_use_ai: boolean;
}
export interface Device {
  imu_check?: {
    available: boolean;
    stable: boolean;
    identity?: number;
    address?: number;
  } | null;
  connected: boolean;
  port: string | null;
  error: string | null;
}
export interface Trial {
  id: number;
  metric: string;
  reference: number;
  measured: number;
  notes: string;
  created_at: string;
}
export interface Validation {
  trials: Trial[];
  summary: Record<
    string,
    {
      count: number;
      mean_absolute_error: number | null;
      max_absolute_error: number | null;
    }
  >;
}
