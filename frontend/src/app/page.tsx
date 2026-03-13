import Link from 'next/link'
import { ArrowRight, Code2, Trophy, Users } from 'lucide-react'

export default function Home() {
  return (
    <div className="flex flex-col relative">
      {/* Animated Background Orbs */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 -left-4 w-72 h-72 bg-primary/30 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob" />
        <div className="absolute top-0 -right-4 w-72 h-72 bg-emerald-500/30 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-teal-500/30 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-4000" />
        <div className="absolute bottom-40 right-20 w-72 h-72 bg-green-400/20 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-6000" />
      </div>

      {/* Gradient Overlay */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-transparent via-background/50 to-background" />

      {/* Hero Section */}
      <section className="py-24 px-4 relative">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary via-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Code. Compete. Conquer.
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join MIT-ADT&apos;s premier competitive programming platform. Sharpen your skills,
            compete in contests, and climb the leaderboard.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/register"
              className="group px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium flex items-center gap-2 hover:scale-105 hover:shadow-lg hover:shadow-primary/25 transition-all duration-300"
            >
              Get Started{' '}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/problems"
              className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-accent hover:border-primary/50 transition-all duration-300 backdrop-blur-sm bg-background/50"
            >
              Browse Problems
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4 relative">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Why CodeForge?</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Link href="/problems">
              <div className="group p-6 rounded-xl bg-card/50 border border-border/50 backdrop-blur-sm hover:bg-card/70 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Code2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Practice Problems</h3>
                <p className="text-muted-foreground">
                  Curated problems across all difficulty levels to sharpen your skills.
                </p>
              </div>
            </Link>
            <Link href="/contests">
              <div className="group p-6 rounded-xl bg-card/50 border border-border/50 backdrop-blur-sm hover:bg-card/70 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Trophy className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Live Contests</h3>
                <p className="text-muted-foreground">
                  Compete in real-time contests with students from MIT-ADT.
                </p>
              </div>
            </Link>
            <Link href="/ratings">
              <div className="group p-6 rounded-xl bg-card/50 border border-border/50 backdrop-blur-sm hover:bg-card/70 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Users className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Rating System</h3>
                <p className="text-muted-foreground">
                  Track your progress with our ELO-based rating system.
                </p>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <StatCard number="100+" label="Problems" />
            <StatCard number="500+" label="Users" />
            <StatCard number="50+" label="Contests" />
            <StatCard number="10K+" label="Submissions" />
          </div>
        </div>
      </section>
    </div>
  )
}

function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="text-center p-6 rounded-xl bg-card/30 border border-border/30 backdrop-blur-sm">
      <div className="text-3xl font-bold text-primary mb-1">{number}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  )
}
