/** Sample master resume (fictional person) so the extension is demoable immediately. */
import type { Bullet, MasterResume } from './schemas';
import { detectMetric } from './text';

function b(id: string, text: string, tags: string[] = [], alternates: string[] = []): Bullet {
  return { id, text, tags, hasMetric: detectMetric(text), alternates };
}

export const SEED_MASTER: MasterResume = {
  version: 1,
  header: {
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    phone: '(555) 010-2030',
    location: 'Seattle, WA',
    links: [
      { label: 'linkedin.com/in/alexrivera-demo', url: 'https://www.linkedin.com/in/alexrivera-demo' },
      { label: 'github.com/alexrivera-demo', url: 'https://github.com/alexrivera-demo' },
    ],
  },
  summaries: [
    {
      id: 'sum_backend',
      label: 'Backend / platform',
      text: 'Backend engineer with 8 years of experience building distributed systems and data pipelines in Go, Python, and TypeScript. Led migrations to Kubernetes and event-driven architectures serving millions of requests per day.',
      tags: ['backend', 'platform', 'distributed-systems'],
    },
    {
      id: 'sum_fullstack',
      label: 'Full-stack / product',
      text: 'Full-stack engineer with 8 years of experience shipping customer-facing products with React, TypeScript, and Node.js. Comfortable owning features end to end, from database schema to UI.',
      tags: ['frontend', 'fullstack', 'product'],
    },
    {
      id: 'sum_ml',
      label: 'ML / data',
      text: 'Software engineer with 8 years of experience, including 3 building ML-backed features and data platforms in Python. Focused on reliable pipelines, evaluation, and getting models into production.',
      tags: ['ml', 'data'],
    },
  ],
  experience: [
    {
      id: 'exp_northwind',
      company: 'Northwind Logistics',
      title: 'Senior Software Engineer',
      location: 'Seattle, WA',
      start: '2021-03',
      end: 'present',
      bullets: [
        b('b_nw_1', 'Led the migration of 14 services from VMs to Kubernetes (EKS), cutting deploy time from 45 minutes to 6 minutes.', ['kubernetes', 'aws', 'devops', 'leadership']),
        b('b_nw_2', 'Designed an event-driven shipment tracking pipeline on Kafka processing 30M events per day with exactly-once semantics.', ['kafka', 'distributed-systems', 'backend']),
        b('b_nw_3', 'Built a Go gRPC pricing service that reduced quote latency p99 from 900 ms to 120 ms.', ['go', 'grpc', 'performance', 'backend']),
        b('b_nw_4', 'Mentored 5 engineers and ran the backend interview loop, hiring 7 engineers over two years.', ['mentoring', 'leadership', 'hiring']),
        b('b_nw_5', 'Introduced OpenTelemetry tracing and SLO dashboards in Grafana, reducing mean time to resolution by 40%.', ['observability', 'sre', 'grafana']),
        b('b_nw_6', 'Partnered with product and operations to launch carrier self-service onboarding used by 1,200 carriers.', ['product', 'cross-functional']),
        b('b_nw_7', 'Wrote the team RFC process and authored design docs for three cross-team platform initiatives.', ['communication', 'leadership']),
      ],
    },
    {
      id: 'exp_lumen',
      company: 'Lumen Health',
      title: 'Software Engineer II',
      location: 'Remote',
      start: '2018-06',
      end: '2021-02',
      bullets: [
        b('b_lh_1', 'Built patient scheduling features in React and TypeScript used by 300 clinics.', ['react', 'typescript', 'frontend']),
        b('b_lh_2', 'Developed Node.js REST APIs on PostgreSQL with row-level security for HIPAA-compliant data access.', ['nodejs', 'postgresql', 'security', 'backend']),
        b('b_lh_3', 'Cut page load time by 55% by code-splitting the scheduling app and caching API responses.', ['performance', 'frontend']),
        b('b_lh_4', 'Created a Python ETL pipeline in Airflow that consolidated 4 data sources into the analytics warehouse.', ['python', 'airflow', 'data']),
        b('b_lh_5', 'Added end-to-end tests with Playwright, raising release confidence and cutting regressions by 30%.', ['testing', 'playwright', 'quality']),
        b('b_lh_6', 'Participated in on-call rotation and wrote runbooks for the top 10 alerts.', ['sre', 'on-call']),
      ],
    },
    {
      id: 'exp_brightpath',
      company: 'BrightPath Software',
      title: 'Software Engineer',
      location: 'Portland, OR',
      start: '2016-07',
      end: '2018-05',
      bullets: [
        b('b_bp_1', 'Maintained a Django e-commerce platform and shipped 20+ features for checkout and inventory.', ['python', 'django', 'backend']),
        b('b_bp_2', 'Automated CI builds with Jenkins and Docker, reducing build failures caused by environment drift.', ['ci-cd', 'docker', 'devops']),
        b('b_bp_3', 'Wrote SQL reports for the finance team, replacing a manual weekly spreadsheet process.', ['sql', 'data']),
        b('b_bp_4', 'Migrated image storage to Amazon S3 with CloudFront, saving $4K per month in hosting costs.', ['aws', 'cost']),
      ],
    },
  ],
  projects: [
    {
      id: 'proj_tracekit',
      name: 'tracekit (open source)',
      links: [{ label: 'github.com/alexrivera-demo/tracekit', url: 'https://github.com/alexrivera-demo/tracekit' }],
      tags: ['open-source', 'go', 'observability'],
      bullets: [
        b('b_tk_1', 'Lightweight Go library for propagating trace context across message queues; 1.1K GitHub stars.', ['go', 'open-source', 'observability']),
        b('b_tk_2', 'Supports Kafka, NATS, and SQS with a pluggable carrier interface and 95% test coverage.', ['kafka', 'testing']),
      ],
    },
    {
      id: 'proj_mealplan',
      name: 'Meal planner with LLM suggestions',
      links: [],
      tags: ['ml', 'llm', 'fullstack'],
      bullets: [
        b('b_mp_1', 'Next.js app that generates weekly meal plans with an LLM and validates output against a nutrition schema.', ['react', 'typescript', 'llm']),
        b('b_mp_2', 'Built an evaluation harness of 200 test prompts to catch regressions when changing prompts or models.', ['llm', 'evaluation', 'testing']),
      ],
    },
    {
      id: 'proj_transit',
      name: 'Transit delay predictor',
      links: [],
      tags: ['ml', 'data', 'python'],
      bullets: [
        b('b_tr_1', 'Trained a gradient-boosted model in Python (scikit-learn) on 2 years of public transit data to predict bus delays.', ['python', 'ml', 'scikit-learn']),
        b('b_tr_2', 'Served predictions through a FastAPI endpoint deployed on AWS Lambda.', ['python', 'aws', 'api']),
      ],
    },
  ],
  skillGroups: [
    {
      id: 'grp_lang',
      name: 'Languages',
      skills: [
        { id: 'sk_go', name: 'Go', aliases: ['golang'] },
        { id: 'sk_python', name: 'Python', aliases: ['py'] },
        { id: 'sk_ts', name: 'TypeScript', aliases: ['ts'] },
        { id: 'sk_js', name: 'JavaScript', aliases: ['js', 'ecmascript'] },
        { id: 'sk_sql', name: 'SQL', aliases: [] },
        { id: 'sk_java', name: 'Java', aliases: [] },
      ],
    },
    {
      id: 'grp_infra',
      name: 'Infrastructure',
      skills: [
        { id: 'sk_k8s', name: 'Kubernetes', aliases: ['k8s', 'eks', 'gke'] },
        { id: 'sk_docker', name: 'Docker', aliases: ['containers'] },
        { id: 'sk_aws', name: 'AWS', aliases: ['amazon web services', 'ec2', 's3', 'lambda'] },
        { id: 'sk_terraform', name: 'Terraform', aliases: ['iac', 'infrastructure as code'] },
        { id: 'sk_kafka', name: 'Kafka', aliases: ['apache kafka'] },
        { id: 'sk_otel', name: 'OpenTelemetry', aliases: ['otel', 'tracing'] },
        { id: 'sk_grafana', name: 'Grafana', aliases: ['prometheus'] },
        { id: 'sk_cicd', name: 'CI/CD', aliases: ['jenkins', 'github actions', 'continuous integration'] },
      ],
    },
    {
      id: 'grp_frameworks',
      name: 'Frameworks & Data',
      skills: [
        { id: 'sk_react', name: 'React', aliases: ['react.js', 'reactjs', 'next.js', 'nextjs'] },
        { id: 'sk_node', name: 'Node.js', aliases: ['node', 'nodejs', 'express'] },
        { id: 'sk_grpc', name: 'gRPC', aliases: ['protobuf', 'protocol buffers'] },
        { id: 'sk_postgres', name: 'PostgreSQL', aliases: ['postgres', 'psql'] },
        { id: 'sk_airflow', name: 'Airflow', aliases: ['apache airflow'] },
        { id: 'sk_django', name: 'Django', aliases: [] },
        { id: 'sk_fastapi', name: 'FastAPI', aliases: [] },
        { id: 'sk_sklearn', name: 'scikit-learn', aliases: ['sklearn'] },
        { id: 'sk_playwright', name: 'Playwright', aliases: ['e2e testing', 'end-to-end testing'] },
      ],
    },
  ],
  education: [
    {
      id: 'edu_osu',
      school: 'Oregon State University',
      degree: 'B.S. Computer Science',
      location: 'Corvallis, OR',
      start: '2012-09',
      end: '2016-06',
      details: '',
    },
  ],
};
