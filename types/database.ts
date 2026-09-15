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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_events: {
        Row: {
          can_access_premium: boolean
          created_at: string
          expires_at: string | null
          id: number
          is_active: boolean
          is_admin: boolean
          reason: string
          seconds_remaining: number | null
          server_time: string
          status: string | null
          user_id: string
        }
        Insert: {
          can_access_premium: boolean
          created_at?: string
          expires_at?: string | null
          id?: never
          is_active: boolean
          is_admin?: boolean
          reason: string
          seconds_remaining?: number | null
          server_time?: string
          status?: string | null
          user_id: string
        }
        Update: {
          can_access_premium?: boolean
          created_at?: string
          expires_at?: string | null
          id?: never
          is_active?: boolean
          is_admin?: boolean
          reason?: string
          seconds_remaining?: number | null
          server_time?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      achievements: {
        Row: {
          achievement_id: string
          earned_at: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          changes: Json
          created_at: string
          entity_id: string | null
          entity_label: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          changes?: Json
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          changes?: Json
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          featured_collection_id: string | null
          id: number
          maintenance_message: string | null
          maintenance_mode: boolean
          min_supported_version: string | null
          signup_enabled: boolean
          support_email: string | null
          updated_at: string
        }
        Insert: {
          featured_collection_id?: string | null
          id?: number
          maintenance_message?: string | null
          maintenance_mode?: boolean
          min_supported_version?: string | null
          signup_enabled?: boolean
          support_email?: string | null
          updated_at?: string
        }
        Update: {
          featured_collection_id?: string | null
          id?: number
          maintenance_message?: string | null
          maintenance_mode?: boolean
          min_supported_version?: string | null
          signup_enabled?: boolean
          support_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_featured_collection_fk"
            columns: ["featured_collection_id"]
            isOneToOne: false
            referencedRelation: "admin_collection_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_settings_featured_collection_fk"
            columns: ["featured_collection_id"]
            isOneToOne: false
            referencedRelation: "collection_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_settings_featured_collection_fk"
            columns: ["featured_collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      authors: {
        Row: {
          avatar_path: string | null
          bio: string | null
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      book_categories: {
        Row: {
          book_id: string
          category_id: string
          created_at: string
        }
        Insert: {
          book_id: string
          category_id: string
          created_at?: string
        }
        Update: {
          book_id?: string
          category_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_categories_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_categories_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_categories_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_categories_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "book_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "admin_category_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "category_with_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          author_id: string
          cover_color: string | null
          cover_color_dark: string | null
          cover_path: string | null
          created_at: string
          currency: string
          description: string
          file_size_bytes: number | null
          format: string
          genre: string | null
          id: string
          is_premium: boolean
          is_published: boolean
          language: string | null
          page_count: number | null
          pdf_path: string | null
          pdf_updated_at: string
          price_cents: number
          published_at: string | null
          rating: number
          rating_count: number
          read_time_minutes: number | null
          search_vector: unknown
          search_vector_simple: unknown
          slug: string
          tag: string | null
          tags: string[]
          title: string
          updated_at: string
          upload_batch_id: string | null
        }
        Insert: {
          author_id: string
          cover_color?: string | null
          cover_color_dark?: string | null
          cover_path?: string | null
          created_at?: string
          currency?: string
          description?: string
          file_size_bytes?: number | null
          format?: string
          genre?: string | null
          id?: string
          is_premium?: boolean
          is_published?: boolean
          language?: string | null
          page_count?: number | null
          pdf_path?: string | null
          pdf_updated_at?: string
          price_cents?: number
          published_at?: string | null
          rating?: number
          rating_count?: number
          read_time_minutes?: number | null
          search_vector?: unknown
          search_vector_simple?: unknown
          slug: string
          tag?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          upload_batch_id?: string | null
        }
        Update: {
          author_id?: string
          cover_color?: string | null
          cover_color_dark?: string | null
          cover_path?: string | null
          created_at?: string
          currency?: string
          description?: string
          file_size_bytes?: number | null
          format?: string
          genre?: string | null
          id?: string
          is_premium?: boolean
          is_published?: boolean
          language?: string | null
          page_count?: number | null
          pdf_path?: string | null
          pdf_updated_at?: string
          price_cents?: number
          published_at?: string | null
          rating?: number
          rating_count?: number
          read_time_minutes?: number | null
          search_vector?: unknown
          search_vector_simple?: unknown
          slug?: string
          tag?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          upload_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "books_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "admin_author_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["author_id"]
          },
          {
            foreignKeyName: "books_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["author_id"]
          },
          {
            foreignKeyName: "books_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "admin_upload_batch_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      carousel_slides: {
        Row: {
          accent: string | null
          badge: string | null
          book_id: string
          created_at: string
          cta_label: string | null
          ends_at: string | null
          headline: string | null
          id: string
          image_path: string | null
          is_active: boolean
          sort_order: number
          starts_at: string | null
          subtitle: string | null
          updated_at: string
        }
        Insert: {
          accent?: string | null
          badge?: string | null
          book_id: string
          created_at?: string
          cta_label?: string | null
          ends_at?: string | null
          headline?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          sort_order?: number
          starts_at?: string | null
          subtitle?: string | null
          updated_at?: string
        }
        Update: {
          accent?: string | null
          badge?: string | null
          book_id?: string
          created_at?: string
          cta_label?: string | null
          ends_at?: string | null
          headline?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          sort_order?: number
          starts_at?: string | null
          subtitle?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carousel_slides_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_slides_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_slides_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_slides_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
        ]
      }
      carousel_weekly: {
        Row: {
          book_id: string
          created_at: string
          sort_order: number
          week_start: string
        }
        Insert: {
          book_id: string
          created_at?: string
          sort_order?: number
          week_start: string
        }
        Update: {
          book_id?: string
          created_at?: string
          sort_order?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "carousel_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
        ]
      }
      categories: {
        Row: {
          accent: string | null
          accent_dark: string | null
          created_at: string
          icon_key: string
          id: string
          label: string
          slug: string
          sort_order: number
        }
        Insert: {
          accent?: string | null
          accent_dark?: string | null
          created_at?: string
          icon_key?: string
          id?: string
          label: string
          slug: string
          sort_order?: number
        }
        Update: {
          accent?: string | null
          accent_dark?: string | null
          created_at?: string
          icon_key?: string
          id?: string
          label?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      collection_books: {
        Row: {
          book_id: string
          collection_id: string
          created_at: string
          sort_order: number
        }
        Insert: {
          book_id: string
          collection_id: string
          created_at?: string
          sort_order?: number
        }
        Update: {
          book_id?: string
          collection_id?: string
          created_at?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_books_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_books_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_books_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_books_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "collection_books_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "admin_collection_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_books_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collection_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_books_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          accent: string | null
          created_at: string
          id: string
          is_published: boolean
          kind: string
          slug: string
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          accent?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          kind?: string
          slug: string
          sort_order?: number
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          accent?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          kind?: string
          slug?: string
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      device_push_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_name: string | null
          disabled_at: string | null
          disabled_reason: string | null
          last_seen_at: string
          notify_library: boolean
          notify_membership: boolean
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          last_seen_at?: string
          notify_library?: boolean
          notify_membership?: boolean
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          last_seen_at?: string
          notify_library?: boolean
          notify_membership?: boolean
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      downloads: {
        Row: {
          book_id: string
          created_at: string
          downloaded_at: string
          file_size_bytes: number | null
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          downloaded_at?: string
          file_size_bytes?: number | null
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          downloaded_at?: string
          file_size_bytes?: number | null
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "downloads_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downloads_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downloads_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downloads_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "downloads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downloads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          last_revenuecat_event_at: string | null
          last_revenuecat_event_id: string | null
          plan_id: string | null
          raw_event: Json | null
          revenuecat_app_user_id: string | null
          revenuecat_entitlement_id: string | null
          starts_at: string | null
          status: string
          store: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          last_revenuecat_event_at?: string | null
          last_revenuecat_event_id?: string | null
          plan_id?: string | null
          raw_event?: Json | null
          revenuecat_app_user_id?: string | null
          revenuecat_entitlement_id?: string | null
          starts_at?: string | null
          status?: string
          store?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          last_revenuecat_event_at?: string | null
          last_revenuecat_event_id?: string | null
          plan_id?: string | null
          raw_event?: Json | null
          revenuecat_app_user_id?: string | null
          revenuecat_entitlement_id?: string | null
          starts_at?: string | null
          status?: string
          store?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "admin_plan_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      highlights: {
        Row: {
          book_id: string
          color: string | null
          created_at: string
          id: string
          note: string | null
          page_number: number | null
          text_excerpt: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          color?: string | null
          created_at?: string
          id?: string
          note?: string | null
          page_number?: number | null
          text_excerpt?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          color?: string | null
          created_at?: string
          id?: string
          note?: string | null
          page_number?: number | null
          text_excerpt?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "highlights_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "highlights_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "highlights_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "highlights_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "highlights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "highlights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          app_store_product_id: string | null
          code: string
          created_at: string
          currency: string
          features: Json
          id: string
          interval: string
          is_active: boolean
          name: string
          play_store_product_id: string | null
          price_cents: number
          revenuecat_product_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          app_store_product_id?: string | null
          code: string
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          name: string
          play_store_product_id?: string | null
          price_cents: number
          revenuecat_product_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          app_store_product_id?: string | null
          code?: string
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          name?: string
          play_store_product_id?: string | null
          price_cents?: number
          revenuecat_product_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          avatar_path: string | null
          city: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          full_name: string | null
          id: string
          monthly_goal: number
          phone: string | null
          postal_code: string | null
          role: string
          state: string | null
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_path?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          monthly_goal?: number
          phone?: string | null
          postal_code?: string | null
          role?: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_path?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          monthly_goal?: number
          phone?: string | null
          postal_code?: string | null
          role?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_outbox: {
        Row: {
          attempts: number
          audience: string
          count: number
          created_at: string
          data: Json
          deliver_after: string
          entity_id: string | null
          failed_count: number | null
          id: number
          kind: string
          last_error: string | null
          processed_at: string | null
          recipients: string[]
          sent_count: number | null
          status: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          audience: string
          count?: number
          created_at?: string
          data?: Json
          deliver_after?: string
          entity_id?: string | null
          failed_count?: number | null
          id?: never
          kind: string
          last_error?: string | null
          processed_at?: string | null
          recipients?: string[]
          sent_count?: number | null
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          audience?: string
          count?: number
          created_at?: string
          data?: Json
          deliver_after?: string
          entity_id?: string | null
          failed_count?: number | null
          id?: never
          kind?: string
          last_error?: string | null
          processed_at?: string | null
          recipients?: string[]
          sent_count?: number | null
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reading_days: {
        Row: {
          day: string
          night_sessions: number
          pages_read: number
          sessions: number
          updated_at: string
          user_id: string
        }
        Insert: {
          day: string
          night_sessions?: number
          pages_read?: number
          sessions?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          day?: string
          night_sessions?: number
          pages_read?: number
          sessions?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_days_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_days_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_progress: {
        Row: {
          book_id: string
          chapter_label: string | null
          created_at: string
          current_page: number
          finished_at: string | null
          id: string
          last_read_at: string
          progress: number
          total_pages: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          chapter_label?: string | null
          created_at?: string
          current_page?: number
          finished_at?: string | null
          id?: string
          last_read_at?: string
          progress?: number
          total_pages?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          chapter_label?: string | null
          created_at?: string
          current_page?: number
          finished_at?: string | null
          id?: string
          last_read_at?: string
          progress?: number
          total_pages?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_progress_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_progress_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_progress_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_progress_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "reading_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_streaks: {
        Row: {
          current_streak: number
          last_read_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          last_read_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          last_read_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_streaks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_streaks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      revenuecat_events: {
        Row: {
          event_timestamp: string
          event_type: string
          id: string
          processed_at: string
          raw_event: Json
          user_id: string
        }
        Insert: {
          event_timestamp: string
          event_type: string
          id: string
          processed_at?: string
          raw_event?: Json
          user_id: string
        }
        Update: {
          event_timestamp?: string
          event_type?: string
          id?: string
          processed_at?: string
          raw_event?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenuecat_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenuecat_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trending_weekly: {
        Row: {
          book_id: string
          created_at: string
          sort_order: number
          week_start: string
        }
        Insert: {
          book_id: string
          created_at?: string
          sort_order?: number
          week_start: string
        }
        Update: {
          book_id?: string
          created_at?: string
          sort_order?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "trending_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trending_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trending_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trending_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
        ]
      }
      upload_batches: {
        Row: {
          category_id: string | null
          collection_id: string | null
          created_at: string
          created_by: string | null
          id: string
          published_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_batches_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "admin_category_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "category_with_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "admin_collection_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collection_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      user_recommendations: {
        Row: {
          book_id: string
          generated_at: string
          rank: number
          reason_label: string | null
          reason_type: string
          score: number
          seed_book_id: string | null
          user_id: string
        }
        Insert: {
          book_id: string
          generated_at?: string
          rank: number
          reason_label?: string | null
          reason_type: string
          score?: number
          seed_book_id?: string | null
          user_id: string
        }
        Update: {
          book_id?: string
          generated_at?: string
          rank?: number
          reason_label?: string | null
          reason_type?: string
          score?: number
          seed_book_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_recommendations_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_recommendations_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_recommendations_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_recommendations_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "user_recommendations_seed_book_id_fkey"
            columns: ["seed_book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_recommendations_seed_book_id_fkey"
            columns: ["seed_book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_recommendations_seed_book_id_fkey"
            columns: ["seed_book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_recommendations_seed_book_id_fkey"
            columns: ["seed_book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "user_recommendations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_recommendations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_taste_state: {
        Row: {
          recommendations_generated_at: string | null
          signals_updated_at: string
          user_id: string
        }
        Insert: {
          recommendations_generated_at?: string | null
          signals_updated_at?: string
          user_id: string
        }
        Update: {
          recommendations_generated_at?: string | null
          signals_updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_taste_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_taste_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlist: {
        Row: {
          book_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "wishlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_author_rows: {
        Row: {
          avatar_path: string | null
          bio: string | null
          book_count: number | null
          created_at: string | null
          id: string | null
          name: string | null
          published_count: number | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_path?: string | null
          bio?: string | null
          book_count?: never
          created_at?: string | null
          id?: string | null
          name?: string | null
          published_count?: never
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_path?: string | null
          bio?: string | null
          book_count?: never
          created_at?: string | null
          id?: string | null
          name?: string | null
          published_count?: never
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      admin_book_rows: {
        Row: {
          author_id: string | null
          author_name: string | null
          category_ids: string[] | null
          collection_ids: string[] | null
          cover_color: string | null
          cover_color_dark: string | null
          cover_path: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          download_count: number | null
          file_size_bytes: number | null
          format: string | null
          genre: string | null
          id: string | null
          is_premium: boolean | null
          is_published: boolean | null
          language: string | null
          length_bucket: string | null
          page_count: number | null
          pdf_path: string | null
          price_cents: number | null
          published_at: string | null
          rating: number | null
          rating_count: number | null
          read_time_minutes: number | null
          reader_count: number | null
          slug: string | null
          tag: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
          upload_batch_id: string | null
          wishlist_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "books_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "admin_author_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["author_id"]
          },
          {
            foreignKeyName: "books_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["author_id"]
          },
          {
            foreignKeyName: "books_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "admin_upload_batch_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_carousel_fallback_rows: {
        Row: {
          author_name: string | null
          book_id: string | null
          cover_path: string | null
          is_premium: boolean | null
          is_published: boolean | null
          slug: string | null
          sort_order: number | null
          title: string | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carousel_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
        ]
      }
      admin_carousel_rows: {
        Row: {
          accent: string | null
          author_name: string | null
          badge: string | null
          book_cover_color: string | null
          book_cover_path: string | null
          book_id: string | null
          book_slug: string | null
          book_title: string | null
          created_at: string | null
          cta_label: string | null
          ends_at: string | null
          headline: string | null
          id: string | null
          image_path: string | null
          is_active: boolean | null
          is_live: boolean | null
          is_premium: boolean | null
          is_published: boolean | null
          sort_order: number | null
          starts_at: string | null
          subtitle: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carousel_slides_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_slides_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_slides_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carousel_slides_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
        ]
      }
      admin_category_rows: {
        Row: {
          accent: string | null
          accent_dark: string | null
          book_count: number | null
          created_at: string | null
          icon_key: string | null
          id: string | null
          label: string | null
          slug: string | null
          sort_order: number | null
        }
        Insert: {
          accent?: string | null
          accent_dark?: string | null
          book_count?: never
          created_at?: string | null
          icon_key?: string | null
          id?: string | null
          label?: string | null
          slug?: string | null
          sort_order?: number | null
        }
        Update: {
          accent?: string | null
          accent_dark?: string | null
          book_count?: never
          created_at?: string | null
          icon_key?: string | null
          id?: string | null
          label?: string | null
          slug?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      admin_collection_rows: {
        Row: {
          accent: string | null
          book_count: number | null
          created_at: string | null
          id: string | null
          is_published: boolean | null
          is_system: boolean | null
          kind: string | null
          published_count: number | null
          slug: string | null
          sort_order: number | null
          subtitle: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          accent?: string | null
          book_count?: never
          created_at?: string | null
          id?: string | null
          is_published?: boolean | null
          is_system?: never
          kind?: string | null
          published_count?: never
          slug?: string | null
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          accent?: string | null
          book_count?: never
          created_at?: string | null
          id?: string | null
          is_published?: boolean | null
          is_system?: never
          kind?: string | null
          published_count?: never
          slug?: string | null
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      admin_plan_rows: {
        Row: {
          app_store_product_id: string | null
          code: string | null
          created_at: string | null
          currency: string | null
          entitlement_count: number | null
          features: Json | null
          id: string | null
          interval: string | null
          is_active: boolean | null
          name: string | null
          play_store_product_id: string | null
          price_cents: number | null
          revenuecat_product_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          app_store_product_id?: string | null
          code?: string | null
          created_at?: string | null
          currency?: string | null
          entitlement_count?: never
          features?: Json | null
          id?: string | null
          interval?: string | null
          is_active?: boolean | null
          name?: string | null
          play_store_product_id?: string | null
          price_cents?: number | null
          revenuecat_product_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          app_store_product_id?: string | null
          code?: string | null
          created_at?: string | null
          currency?: string | null
          entitlement_count?: never
          features?: Json | null
          id?: string | null
          interval?: string | null
          is_active?: boolean | null
          name?: string | null
          play_store_product_id?: string | null
          price_cents?: number | null
          revenuecat_product_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      admin_trending_rows: {
        Row: {
          author_name: string | null
          book_id: string | null
          cover_path: string | null
          is_premium: boolean | null
          is_published: boolean | null
          slug: string | null
          sort_order: number | null
          title: string | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trending_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "admin_book_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trending_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "book_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trending_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trending_weekly_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "carousel_items"
            referencedColumns: ["book_id"]
          },
        ]
      }
      admin_upload_batch_rows: {
        Row: {
          book_count: number | null
          category_id: string | null
          category_label: string | null
          collection_id: string | null
          collection_title: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          published_at: string | null
          published_count: number | null
          ready_count: number | null
          status: string | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_batches_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "admin_category_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "category_with_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "admin_collection_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collection_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_user_directory: {
        Row: {
          avatar_path: string | null
          books_finished: number | null
          books_started: number | null
          country: string | null
          created_at: string | null
          downloads_count: number | null
          email: string | null
          entitlement_status: string | null
          expires_at: string | null
          full_name: string | null
          id: string | null
          is_subscriber: boolean | null
          last_read_at: string | null
          phone: string | null
          plan_id: string | null
          plan_name: string | null
          role: string | null
          starts_at: string | null
          store: string | null
        }
        Relationships: []
      }
      book_list_items: {
        Row: {
          author_id: string | null
          author_name: string | null
          cover_color: string | null
          cover_color_dark: string | null
          cover_path: string | null
          currency: string | null
          format: string | null
          genre: string | null
          id: string | null
          is_premium: boolean | null
          language: string | null
          length_bucket: string | null
          page_count: number | null
          price_cents: number | null
          published_at: string | null
          rating: number | null
          read_time_minutes: number | null
          slug: string | null
          tag: string | null
          title: string | null
        }
        Relationships: []
      }
      carousel_items: {
        Row: {
          accent: string | null
          author_id: string | null
          author_name: string | null
          badge: string | null
          book_id: string | null
          cover_color: string | null
          cover_color_dark: string | null
          cover_path: string | null
          cta_label: string | null
          currency: string | null
          ends_at: string | null
          format: string | null
          genre: string | null
          headline: string | null
          image_path: string | null
          is_premium: boolean | null
          price_cents: number | null
          published_at: string | null
          rating: number | null
          read_time_minutes: number | null
          slide_id: string | null
          slug: string | null
          sort_order: number | null
          starts_at: string | null
          subtitle: string | null
          tag: string | null
          title: string | null
        }
        Relationships: []
      }
      category_with_counts: {
        Row: {
          accent: string | null
          accent_dark: string | null
          book_count: number | null
          icon_key: string | null
          id: string | null
          label: string | null
          slug: string | null
          sort_order: number | null
        }
        Relationships: []
      }
      collection_summaries: {
        Row: {
          accent: string | null
          book_count: number | null
          id: string | null
          is_system: boolean | null
          kind: string | null
          slug: string | null
          sort_order: number | null
          subtitle: string | null
          title: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_analytics: { Args: { p_days?: number }; Returns: Json }
      admin_bulk_update_books: {
        Args: {
          p_ids: string[]
          p_is_premium?: boolean
          p_is_published?: boolean
        }
        Returns: Json
      }
      admin_carousel_delete: { Args: { p_ids: string[] }; Returns: number }
      admin_carousel_reorder: { Args: { p_ids: string[] }; Returns: number }
      admin_carousel_set: { Args: { p_book_ids: string[] }; Returns: number }
      admin_carousel_upsert: {
        Args: {
          p_accent?: string
          p_badge?: string
          p_book_id?: string
          p_clear_schedule?: boolean
          p_cta_label?: string
          p_ends_at?: string
          p_headline?: string
          p_id?: string
          p_image_path?: string
          p_is_active?: boolean
          p_sort_order?: number
          p_starts_at?: string
          p_subtitle?: string
        }
        Returns: {
          accent: string | null
          badge: string | null
          book_id: string
          created_at: string
          cta_label: string | null
          ends_at: string | null
          headline: string | null
          id: string
          image_path: string | null
          is_active: boolean
          sort_order: number
          starts_at: string | null
          subtitle: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "carousel_slides"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_delete_books: { Args: { p_ids: string[] }; Returns: Json }
      admin_delete_category: {
        Args: { p_force?: boolean; p_id: string }
        Returns: Json
      }
      admin_delete_collection: {
        Args: { p_force?: boolean; p_id: string }
        Returns: Json
      }
      admin_delete_plan: {
        Args: { p_force?: boolean; p_id: string }
        Returns: Json
      }
      admin_delete_storage_object: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      admin_publish_upload_batch: {
        Args: { p_batch_id: string }
        Returns: Json
      }
      admin_refresh_carousel_week: {
        Args: { p_pool?: number; p_week?: string }
        Returns: Json
      }
      admin_refresh_trending_week: {
        Args: { p_pool?: number; p_week?: string }
        Returns: Json
      }
      admin_reorder: {
        Args: { p_ids: string[]; p_table: string }
        Returns: undefined
      }
      admin_set_book_relations: {
        Args: {
          p_book_id: string
          p_category_ids: string[]
          p_collection_ids: string[]
        }
        Returns: undefined
      }
      admin_set_category_books: {
        Args: { p_book_ids: string[]; p_category_id: string }
        Returns: undefined
      }
      admin_set_collection_books: {
        Args: { p_book_ids: string[]; p_collection_id: string }
        Returns: undefined
      }
      admin_set_entitlement: {
        Args: {
          p_expires_at?: string
          p_plan_id?: string
          p_status: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_user_role: {
        Args: { new_role: string; target_id: string }
        Returns: undefined
      }
      admin_storage_audit: { Args: never; Returns: Json }
      admin_upsert_category: {
        Args: {
          p_accent?: string
          p_accent_dark?: string
          p_icon_key?: string
          p_id?: string
          p_label?: string
          p_slug?: string
          p_sort_order?: number
        }
        Returns: {
          accent: string | null
          accent_dark: string | null
          created_at: string
          icon_key: string
          id: string
          label: string
          slug: string
          sort_order: number
        }
        SetofOptions: {
          from: "*"
          to: "categories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_upsert_collection: {
        Args: {
          p_accent?: string
          p_id?: string
          p_is_published?: boolean
          p_kind?: string
          p_slug?: string
          p_sort_order?: number
          p_subtitle?: string
          p_title?: string
        }
        Returns: {
          accent: string | null
          created_at: string
          id: string
          is_published: boolean
          kind: string
          slug: string
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "collections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_upsert_plan: {
        Args: {
          p_app_store_product_id?: string
          p_code?: string
          p_currency?: string
          p_features?: Json
          p_id?: string
          p_interval?: string
          p_is_active?: boolean
          p_name?: string
          p_play_store_product_id?: string
          p_price_cents?: number
          p_revenuecat_product_id?: string
          p_sort_order?: number
        }
        Returns: {
          app_store_product_id: string | null
          code: string
          created_at: string
          currency: string
          features: Json
          id: string
          interval: string
          is_active: boolean
          name: string
          play_store_product_id: string | null
          price_cents: number
          revenuecat_product_id: string | null
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_user_detail: { Args: { p_user_id: string }; Returns: Json }
      apply_revenuecat_entitlement: {
        Args: {
          p_event_at: string
          p_event_id: string
          p_expires_at: string
          p_plan_id: string
          p_raw_event: Json
          p_revenuecat_entitlement_id: string
          p_starts_at: string
          p_status: string
          p_store: string
          p_user_id: string
        }
        Returns: Json
      }
      book_effective_pages: {
        Args: { p_page_count: number; p_read_time_minutes: number }
        Returns: number
      }
      book_length_bucket: {
        Args: { p_page_count: number; p_read_time_minutes: number }
        Returns: string
      }
      book_publish_blocker: { Args: { p_book_id: string }; Returns: string }
      books_search_document: {
        Args: {
          p_author_name: string
          p_description: string
          p_genre: string
          p_tag: string
          p_tags: string[]
          p_title: string
        }
        Returns: unknown
      }
      books_search_vector: {
        Args: {
          description: string
          genre: string
          tag: string
          tags: string[]
          title: string
        }
        Returns: unknown
      }
      books_search_vector_simple: {
        Args: {
          description: string
          genre: string
          tag: string
          tags: string[]
          title: string
        }
        Returns: unknown
      }
      catalog_books: {
        Args: {
          p_category?: string
          p_languages?: string[]
          p_lengths?: string[]
          p_limit?: number
          p_min_rating?: number
          p_offset?: number
          p_premium?: boolean
          p_query?: string
          p_sort?: string
        }
        Returns: {
          author_id: string
          author_name: string
          cover_color: string
          cover_color_dark: string
          cover_path: string
          currency: string
          format: string
          genre: string
          id: string
          is_premium: boolean
          language: string
          length_bucket: string
          page_count: number
          price_cents: number
          published_at: string
          rating: number
          read_time_minutes: number
          slug: string
          tag: string
          title: string
          total_count: number
        }[]
      }
      collection_page: {
        Args: {
          p_id?: string
          p_limit?: number
          p_offset?: number
          p_slug?: string
        }
        Returns: Json
      }
      collection_page_meta: {
        Args: { c: Database["public"]["Tables"]["collections"]["Row"] }
        Returns: Json
      }
      collection_shelf: {
        Args: { p_limit?: number; p_slug: string }
        Returns: {
          author_id: string | null
          author_name: string | null
          cover_color: string | null
          cover_color_dark: string | null
          cover_path: string | null
          currency: string | null
          format: string | null
          genre: string | null
          id: string | null
          is_premium: boolean | null
          language: string | null
          length_bucket: string | null
          page_count: number | null
          price_cents: number | null
          published_at: string | null
          rating: number | null
          read_time_minutes: number | null
          slug: string | null
          tag: string | null
          title: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "book_list_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      current_profile_role: { Args: never; Returns: string }
      current_trending_week: { Args: never; Returns: string }
      ensure_carousel_week: {
        Args: { p_pool?: number; p_week?: string }
        Returns: number
      }
      ensure_trending_week: {
        Args: { p_pool?: number; p_week?: string }
        Returns: number
      }
      entitlement_access_reason: {
        Args: {
          p_expires_at: string
          p_is_admin: boolean
          p_now?: string
          p_status: string
        }
        Returns: string
      }
      entitlement_has_access: {
        Args: { p_expires_at: string; p_now?: string; p_status: string }
        Returns: boolean
      }
      expire_lapsed_entitlements: { Args: never; Returns: number }
      home_carousel: {
        Args: { p_fallback_limit?: number; p_limit?: number }
        Returns: {
          accent: string | null
          author_id: string | null
          author_name: string | null
          badge: string | null
          book_id: string | null
          cover_color: string | null
          cover_color_dark: string | null
          cover_path: string | null
          cta_label: string | null
          currency: string | null
          ends_at: string | null
          format: string | null
          genre: string | null
          headline: string | null
          image_path: string | null
          is_premium: boolean | null
          price_cents: number | null
          published_at: string | null
          rating: number | null
          read_time_minutes: number | null
          slide_id: string | null
          slug: string | null
          sort_order: number | null
          starts_at: string | null
          subtitle: string | null
          tag: string | null
          title: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "carousel_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_admin: { Args: never; Returns: boolean }
      length_bucket: {
        Args: { b: Database["public"]["Tables"]["books"]["Row"] }
        Returns: string
      }
      my_access_state: { Args: never; Returns: Json }
      prune_access_events: { Args: { p_keep_days?: number }; Returns: number }
      prune_push_tables: { Args: never; Returns: number }
      push_outbox_claim: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          audience: string
          count: number
          created_at: string
          data: Json
          deliver_after: string
          entity_id: string | null
          failed_count: number | null
          id: number
          kind: string
          last_error: string | null
          processed_at: string | null
          recipients: string[]
          sent_count: number | null
          status: string
          topic: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "push_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      random_published_books: {
        Args: { p_limit?: number }
        Returns: {
          author_id: string | null
          author_name: string | null
          cover_color: string | null
          cover_color_dark: string | null
          cover_path: string | null
          currency: string | null
          format: string | null
          genre: string | null
          id: string | null
          is_premium: boolean | null
          language: string | null
          length_bucket: string | null
          page_count: number | null
          price_cents: number | null
          published_at: string | null
          rating: number | null
          read_time_minutes: number | null
          slug: string | null
          tag: string | null
          title: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "book_list_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reading_record: { Args: { p_tz?: string }; Returns: Json }
      rebuild_user_recommendations: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: number
      }
      recommendations_for_me: {
        Args: { p_limit?: number; p_per_section?: number; p_sections?: number }
        Returns: Json
      }
      register_push_token: {
        Args: {
          p_app_version?: string
          p_device_name?: string
          p_notify_library?: boolean
          p_notify_membership?: boolean
          p_platform: string
          p_token: string
        }
        Returns: undefined
      }
      search_books: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          author_id: string
          author_name: string
          cover_color: string
          cover_color_dark: string
          cover_path: string
          currency: string
          format: string
          genre: string
          id: string
          is_premium: boolean
          price_cents: number
          published_at: string
          rating: number
          read_time_minutes: number
          slug: string
          tag: string
          title: string
          total_count: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      slugify: { Args: { input: string }; Returns: string }
      storage_object_exists: {
        Args: { p_bucket: string; p_path: string }
        Returns: boolean
      }
      storage_object_key: {
        Args: { p_bucket: string; p_path: string }
        Returns: string
      }
      system_collection_slugs: { Args: never; Returns: string[] }
      toggle_highlight: {
        Args: { p_book_id: string; p_page_number: number }
        Returns: Json
      }
      unaccent: { Args: { "": string }; Returns: string }
      unregister_push_token: { Args: { p_token: string }; Returns: undefined }
      upsert_highlight: {
        Args: {
          p_book_id: string
          p_color?: string
          p_note?: string
          p_page_number: number
          p_text_excerpt?: string
        }
        Returns: Json
      }
      upsert_reading_progress: {
        Args: {
          p_book_id: string
          p_chapter_label?: string
          p_client_updated_at?: string
          p_current_page?: number
          p_progress?: number
          p_total_pages?: number
          p_tz?: string
        }
        Returns: Json
      }
      user_access_state: { Args: { p_user_id: string }; Returns: Json }
      user_has_active_premium: {
        Args: { p_user_id?: string }
        Returns: boolean
      }
      vault_check: {
        Args: { p_book_ids: string[] }
        Returns: {
          book_id: string
          has_pdf: boolean
          is_published: boolean
          pdf_updated_at: string
        }[]
      }
      weekly_trending_books: {
        Args: { p_limit?: number }
        Returns: {
          author_id: string | null
          author_name: string | null
          cover_color: string | null
          cover_color_dark: string | null
          cover_path: string | null
          currency: string | null
          format: string | null
          genre: string | null
          id: string | null
          is_premium: boolean | null
          language: string | null
          length_bucket: string | null
          page_count: number | null
          price_cents: number | null
          published_at: string | null
          rating: number | null
          read_time_minutes: number | null
          slug: string | null
          tag: string | null
          title: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "book_list_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      weekly_trending_meta: { Args: never; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
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

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
