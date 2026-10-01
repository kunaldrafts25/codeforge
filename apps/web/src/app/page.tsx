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
            CodeForge aptitude pilot
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Take reviewed objective assessments with saved answers, a server timer, and a private
            result. Coding submissions and contests are unavailable during this pilot.
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
              href="/aptitude"
              className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-accent hover:border-primary/50 transition-all duration-300 backdrop-blur-sm bg-background/50"
            >
              Browse aptitude tests
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4 relative">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Why CodeForge?</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Code2 className="w-8 h-8" />}
              title="Reviewed questions"
              description="A separate staff reviewer approves each pilot test before candidates can start."
            />
            <FeatureCard
              icon={<Trophy className="w-8 h-8" />}
              title="Reliable progress"
              description="Answers save to the server and remain available after a browser reload."
            />
            <FeatureCard
              icon={<Users className="w-8 h-8" />}
              title="Private results"
              description="Your score is available only in your account after submission or timeout."
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="group p-6 rounded-xl bg-card/50 border border-border/50 backdrop-blur-sm hover:bg-card/70 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  )
}
