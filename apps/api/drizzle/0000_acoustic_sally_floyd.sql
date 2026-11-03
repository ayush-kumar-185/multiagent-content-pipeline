CREATE TABLE "draft_versions" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"run_id" varchar(128) NOT NULL,
	"version" integer NOT NULL,
	"draft" text NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cycle" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" varchar(128) NOT NULL,
	"sequence" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"node" varchar(64),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"topic" text NOT NULL,
	"source_url" text,
	"config" jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"draft" text DEFAULT '' NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claim_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editor_verdict" jsonb,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"research_rounds" integer DEFAULT 0 NOT NULL,
	"write_cycles" integer DEFAULT 0 NOT NULL,
	"open_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" text,
	"role" varchar(32) DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_versions_run_id_version_idx" ON "draft_versions" USING btree ("run_id","version");--> statement-breakpoint
CREATE INDEX "draft_versions_run_id_idx" ON "draft_versions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_events_run_id_seq_idx" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "run_events_run_id_idx" ON "run_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_user_id_idx" ON "runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");