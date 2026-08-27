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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          allow_pdf_without_entitlement: boolean
          id: number
          updated_at: string
        }
        Insert: {
          allow_pdf_without_entitlement?: boolean
          id?: number
          updated_at?: string
        }
        Update: {
          allow_pdf_without_entitlement?: boolean
          id?: number
          updated_at?: string
        }
        Relationships: []
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
          pdf_path: string | null
          price_cents: number
          published_at: string | null
          rating: number
          rating_count: number
          read_time_minutes: number | null
          search_vector: unknown
          slug: string
          tag: string | null
          tags: string[]
          title: string
          updated_at: string
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
          pdf_path?: string | null
          price_cents?: number
          published_at?: string | null
          rating?: number
          rating_count?: number
          read_time_minutes?: number | null
          search_vector?: unknown
          slug: string
          tag?: string | null
          tags?: string[]
          title: string
          updated_at?: string
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
          pdf_path?: string | null
          price_cents?: number
          published_at?: string | null
          rating?: number
          rating_count?: number
          read_time_minutes?: number | null
          search_vector?: unknown
          slug?: string
          tag?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
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
            referencedRelation: "plans"
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
          code: string
          created_at: string
          currency: string
          features: Json
          id: string
          interval: string
          is_active: boolean
          name: string
          price_cents: number
          revenuecat_product_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          name: string
          price_cents: number
          revenuecat_product_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          name?: string
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
          phone?: string | null
          postal_code?: string | null
          role?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reading_progress: {
        Row: {
          book_id: string
          chapter_label: string | null
          created_at: string
          current_page: number
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
      admin_user_directory: {
        Row: {
          created_at: string | null
          email: string | null
          entitlement_status: string | null
          expires_at: string | null
          full_name: string | null
          id: string | null
          plan_name: string | null
          role: string | null
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
      admin_dashboard_stats: { Args: Record<string, never>; Returns: Json }
      admin_set_user_role: {
        Args: { new_role: string; target_id: string }
        Returns: undefined
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      slugify: { Args: { input: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
      user_has_active_premium: {
        Args: { p_user_id?: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
