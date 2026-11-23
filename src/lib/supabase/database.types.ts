// Generated from the Supabase project "agent" (zijruhuvzxtuudsvnwgy) after migration 6
// (management) (MCP generate_typescript_types; unused helper types trimmed). Regenerate after every migration.
// Knowledge entries (migration 8) are hand-written until the migration is applied and types regenerated.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          id: number
          metadata: Json
          target_id: string | null
          target_type: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          created_at?: string
          id?: never
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          id?: never
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      departments: {
        Row: {
          archived_at: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          name_translations: Json
          slug: string
          tenant_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          name_translations?: Json
          slug: string
          tenant_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          name_translations?: Json
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          description: string
          key: string
          planned_phase: number
        }
        Insert: {
          description: string
          key: string
          planned_phase: number
        }
        Update: {
          description?: string
          key?: string
          planned_phase?: number
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          revoked_at: string | null
          role_id: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role_id: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role_id?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_role_id_fkey"
            columns: ["tenant_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          embedding_model: string | null
          heading: string | null
          id: number
          page_from: number | null
          page_to: number | null
          search_tsv: unknown
          tenant_id: string
          version_id: string
          chunk_index: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      knowledge_document_access: {
        Row: {
          department_id: string | null
          document_id: string
          id: string
          role_id: string | null
          tenant_id: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      knowledge_document_versions: {
        Row: {
          activated_at: string | null
          char_count: number | null
          chunk_count: number | null
          created_at: string
          document_id: string
          error_code: string | null
          file_name: string
          id: string
          mime_type: string
          page_count: number | null
          processed_at: string | null
          sha256: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["knowledge_version_status"]
          storage_path: string
          tenant_id: string
          uploaded_by: string | null
          version_no: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      knowledge_documents: {
        Row: {
          archived_at: string | null
          category: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          department_id: string | null
          description: string | null
          effective_date: string | null
          expiry_date: string | null
          id: string
          is_authoritative: boolean
          language: string
          published_at: string | null
          published_by: string | null
          source_priority: number
          source_url: string | null
          tenant_id: string
          title: string
          title_ar: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["knowledge_visibility"]
        }
        Insert: never
        Update: never
        Relationships: []
      }
      membership_departments: {
        Row: {
          department_id: string
          membership_id: string
          tenant_id: string
        }
        Insert: {
          department_id: string
          membership_id: string
          tenant_id: string
        }
        Update: {
          department_id?: string
          membership_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_departments_tenant_id_department_id_fkey"
            columns: ["tenant_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "membership_departments_tenant_id_membership_id_fkey"
            columns: ["tenant_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      membership_roles: {
        Row: {
          created_at: string
          membership_id: string
          role_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          membership_id: string
          role_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          membership_id?: string
          role_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_roles_tenant_id_membership_id_fkey"
            columns: ["tenant_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "membership_roles_tenant_id_role_id_fkey"
            columns: ["tenant_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          description: string
          key: string
        }
        Insert: {
          category: string
          description: string
          key: string
        }
        Update: {
          category?: string
          description?: string
          key?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          created_by: string | null
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_key: string
          role_id: string
          tenant_id: string
        }
        Insert: {
          permission_key: string
          role_id: string
          tenant_id: string
        }
        Update: {
          permission_key?: string
          role_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_tenant_id_role_id_fkey"
            columns: ["tenant_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_access_grants: {
        Row: {
          created_at: string
          expires_at: string
          granted_by: string | null
          grantee_id: string
          id: string
          reason: string
          revoked_at: string | null
          starts_at: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          granted_by?: string | null
          grantee_id: string
          id?: string
          reason: string
          revoked_at?: string | null
          starts_at?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          granted_by?: string | null
          grantee_id?: string
          id?: string
          reason?: string
          revoked_at?: string | null
          starts_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_access_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_branding: {
        Row: {
          draft: Json | null
          published: Json
          published_at: string | null
          published_by: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          draft?: Json | null
          published?: Json
          published_at?: string | null
          published_by?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          draft?: Json | null
          published?: Json
          published_at?: string | null
          published_by?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_branding_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_domains: {
        Row: {
          created_at: string
          hostname: string
          id: string
          is_primary: boolean
          tenant_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          hostname: string
          id?: string
          is_primary?: boolean
          tenant_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          hostname?: string
          id?: string
          is_primary?: boolean
          tenant_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_features: {
        Row: {
          enabled: boolean
          feature_key: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_features_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          status: Database["public"]["Enums"]["membership_status"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["membership_status"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["membership_status"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          allowed_email_domains: string[]
          self_signup_enabled: boolean
          support_email: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allowed_email_domains?: string[]
          self_signup_enabled?: boolean
          support_email?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allowed_email_domains?: string[]
          self_signup_enabled?: boolean
          support_email?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          archived_at: string | null
          created_at: string
          default_locale: string
          id: string
          is_demo: boolean
          name: string
          name_translations: Json
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          default_locale?: string
          id?: string
          is_demo?: boolean
          name: string
          name_translations?: Json
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          default_locale?: string
          id?: string
          is_demo?: boolean
          name?: string
          name_translations?: Json
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      create_invitation: {
        Args: {
          p_email: string
          p_role_key: string
          p_tenant_slug: string
          p_valid_days?: number
        }
        Returns: Json
      }
      create_tenant: {
        Args: {
          p_default_locale?: string
          p_is_demo?: boolean
          p_name: string
          p_owner?: string
          p_slug: string
          p_timezone?: string
        }
        Returns: string
      }
      invitation_preview: { Args: { p_token: string }; Returns: Json }
      knowledge_begin_upload: {
        Args: {
          p_document: string | null
          p_file_name: string
          p_meta?: Json
          p_mime_type: string
          p_size_bytes: number
          p_tenant_slug: string
        }
        Returns: Json
      }
      knowledge_complete_version: {
        Args: { p_chunks: Json; p_stats: Json; p_version: string }
        Returns: undefined
      }
      knowledge_delete_document: { Args: { p_document: string }; Returns: string[] }
      knowledge_set_archived: {
        Args: { p_archived: boolean; p_document: string }
        Returns: undefined
      }
      knowledge_set_embeddings: {
        Args: { p_items: Json; p_model: string; p_version: string }
        Returns: number
      }
      knowledge_set_published: {
        Args: { p_document: string; p_published: boolean }
        Returns: undefined
      }
      knowledge_set_version_status: {
        Args: {
          p_error_code?: string
          p_sha256?: string
          p_status: Database["public"]["Enums"]["knowledge_version_status"]
          p_version: string
        }
        Returns: Json
      }
      knowledge_update_document: {
        Args: { p_document: string; p_meta: Json }
        Returns: undefined
      }
      my_platform_role: {
        Args: never
        Returns: Database["public"]["Enums"]["platform_role"]
      }
      my_tenant_access: { Args: { p_slug: string }; Returns: Json }
      my_workspaces: { Args: never; Returns: Json }
      platform_staff: { Args: never; Returns: Json }
      platform_tenants: { Args: never; Returns: Json }
      publish_branding: { Args: { p_tenant_slug: string }; Returns: undefined }
      search_knowledge: {
        Args: {
          p_embedding?: string
          p_embedding_model?: string
          p_limit?: number
          p_query: string
          p_tenant_slug: string
        }
        Returns: Json
      }
      revoke_invitation: { Args: { p_invitation: string }; Returns: undefined }
      tenant_invitations: { Args: { p_tenant_slug: string }; Returns: Json }
      tenant_members: { Args: { p_tenant_slug: string }; Returns: Json }
      update_tenant_profile: {
        Args: {
          p_default_locale: string
          p_name_translations: Json
          p_tenant_slug: string
          p_timezone: string
        }
        Returns: undefined
      }
    }
    Enums: {
      knowledge_version_status: "uploading" | "queued" | "processing" | "ready" | "failed" | "needs_ocr"
      knowledge_visibility: "public" | "members" | "staff" | "restricted"
      membership_status: "invited" | "active" | "suspended"
      platform_role: "owner" | "admin" | "support" | "billing"
      tenant_status: "trial" | "active" | "suspended" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      knowledge_version_status: ["uploading", "queued", "processing", "ready", "failed", "needs_ocr"],
      knowledge_visibility: ["public", "members", "staff", "restricted"],
      membership_status: ["invited", "active", "suspended"],
      platform_role: ["owner", "admin", "support", "billing"],
      tenant_status: ["trial", "active", "suspended", "archived"],
    },
  },
} as const
