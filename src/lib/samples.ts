export const sampleLatexResume = String.raw`\documentclass[letterpaper,10pt]{article}
\usepackage[margin=0.65in]{geometry}
\usepackage{enumitem}
\usepackage{hyperref}
\newcommand{\resumeItem}[1]{\item\small{#1}}
\newcommand{\resumeSubheading}[4]{
  \item
  \textbf{#1} \hfill #2\\
  \textit{#3} \hfill \textit{#4}
}

\begin{document}

\begin{center}
  {\LARGE Aparnna Hariharan}\\
  \href{mailto:aparnna@example.com}{aparnna@example.com} $|$ Toronto, ON $|$ github.com/aparnna
\end{center}

\section{Summary}
Product-minded software engineer with experience building React, TypeScript, and Node.js applications for data-heavy workflows. Comfortable partnering with designers and product managers to ship reliable user experiences.

\section{Skills}
\textbf{Languages:} TypeScript, JavaScript, Python, SQL, HTML, CSS\\
\textbf{Frameworks:} React, Next.js, Node.js, Express, Tailwind CSS\\
\textbf{Tools:} PostgreSQL, Supabase, GitHub Actions, Playwright, Jest

\section{Experience}
\begin{itemize}[leftmargin=*]
\resumeSubheading{Northstar Labs}{2024 -- Present}{Software Engineer}{Toronto, ON}
\begin{itemize}
  \resumeItem{Built React and TypeScript dashboards that helped operations teams review customer workflow data with fewer manual checks.}
  \resumeItem{Implemented Node.js API endpoints backed by PostgreSQL and Supabase row-level security policies.}
  \resumeItem{Added Playwright smoke tests and GitHub Actions checks to reduce production regressions before release.}
\end{itemize}

\resumeSubheading{Campus Tools}{2022 -- 2024}{Frontend Developer}{Waterloo, ON}
\begin{itemize}
  \resumeItem{Collaborated with product managers to redesign onboarding flows in Next.js and improve form completion clarity.}
  \resumeItem{Created reusable Tailwind CSS components and documented patterns for a small engineering team.}
\end{itemize}
\end{itemize}

\section{Projects}
\begin{itemize}[leftmargin=*]
  \resumeItem{Built a travel journal app with Next.js, Supabase, country maps, privacy controls, and export workflows.}
  \resumeItem{Created a local music translation prototype that synced LRCLIB lyrics with Spotify Desktop playback.}
\end{itemize}

\section{Education}
\resumeSubheading{University of Waterloo}{2022}{B.S. Computer Science}{Waterloo, ON}

\end{document}
`;

export const sampleOverleafFiles = [
  {
    name: "altacv.cls",
    content: String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{altacv}[2026/07/16 sample TailorTeX class]
\LoadClass{article}
\newcommand{\name}[1]{\def\@name{#1}}
\newcommand{\tagline}[1]{\def\@tagline{#1}}
\newcommand{\cvsection}[1]{\section{#1}}
\newcommand{\cvevent}[4]{\textbf{#1}\hfill #2\\\textit{#3}\hfill\textit{#4}\\}
\newcommand{\cvachievement}[3]{\textbf{#2}: #3\\}
\newcommand{\cvskill}[2]{#1 #2\\}
\newcommand{\cvtag}[1]{#1\quad}
`
  },
  {
    name: "main.tex",
    content: String.raw`\documentclass[10pt,a4paper]{altacv}

\begin{document}
\name{Aparnna Hariharan}
\tagline{Software Engineer}

\cvsection{Summary}
Product-minded software engineer with experience building React, TypeScript, and Node.js applications for data-heavy workflows.

\cvsection{Experience}
\cvevent{Software Engineer}{2024 -- Present}{Northstar Labs}{Toronto, ON}
\cvachievement{}{Built dashboards}{Built React and TypeScript dashboards that helped operations teams review customer workflow data with fewer manual checks.}
\cvachievement{}{Improved APIs}{Implemented Node.js API endpoints backed by PostgreSQL and Supabase row-level security policies.}

\input{page1sidebar}
\input{page2sidebar}
\end{document}
`
  },
  {
    name: "page1sidebar.tex",
    content: String.raw`\cvsection{Skills}
\cvtag{TypeScript}
\cvtag{React}
\cvtag{Next.js}
\cvtag{Node.js}
\cvtag{PostgreSQL}
\cvtag{Supabase}

\cvsection{Testing}
\cvskill{Playwright}{4}
\cvskill{Jest}{3}
`
  },
  {
    name: "page2sidebar.tex",
    content: String.raw`\cvsection{Projects}
\cvproject{Travel Journal}
\cvachievement{}{Privacy controls}{Built a travel journal app with Next.js, Supabase, country maps, privacy controls, and export workflows.}

\cvproject{Music Translation}
\cvachievement{}{Synced lyrics}{Created a local music translation prototype that synced LRCLIB lyrics with Spotify Desktop playback.}
`
  }
];

export const sampleJobDescription = `Junior Software Engineer, Frontend
Company: Aurora Systems

Aurora Systems is hiring an entry-level frontend software engineer to help build internal workflow products for operations and customer success teams. This role is a good fit for someone with internship, project, research, or early professional experience who wants to grow on a collaborative engineering team.

Required qualifications:
- Internship, academic, project, or 0-2 years of professional software engineering experience
- Working knowledge of TypeScript, JavaScript, and React
- Familiarity with Next.js or similar frontend frameworks
- Ability to partner with product managers and designers
- Basic experience with automated testing, ideally Playwright or Jest
- Comfort learning REST APIs, Node.js, and SQL-backed services

Preferred qualifications:
- Tailwind CSS or design system experience
- Familiarity with Supabase or PostgreSQL security policies
- Exposure to GitHub Actions, CI/CD, or release checks
- Clear written communication and documentation habits

Responsibilities:
- Build reliable frontend workflows for data-heavy internal tools with support from senior engineers
- Collaborate with product and design to clarify ambiguous requirements
- Add tests and fix bugs to improve release confidence
- Participate in code reviews and learn frontend best practices
- Use customer feedback to make small product improvements
`;
