import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Crown,
  Radio,
  Minus,
  ArrowRight,
  Download,
  FileCode,
  FolderOpen,
  Settings,
  Play,
  CheckCircle2,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Zap
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export function EASetupGuide() {
  const [faqOpen, setFaqOpen] = React.useState<string | null>(null);

  const eaRoles = [
    {
      role: 'Master',
      ea: 'TradeCopierMaster.mq5',
      icon: Crown,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      features: [
        'Journals all trades to cloud',
        'Writes trade events to local queue',
        'No trade execution on other accounts'
      ]
    },
    {
      role: 'Receiver',
      ea: 'TradeCopierReceiver.mq5',
      icon: Radio,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      features: [
        'Reads events from local queue',
        'Executes trades with risk scaling',
        'Journals executed trades to cloud',
        'Also captures manual trades'
      ]
    },
    {
      role: 'Independent',
      ea: 'TradeJournalBridge.mq5',
      icon: Minus,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
      features: [
        'Journals trades to cloud only',
        'No copying functionality',
        'For standalone journaling'
      ]
    }
  ];

  const setupSteps = [
    {
      step: 1,
      icon: Settings,
      title: 'Assign Account Roles',
      description: 'In the Accounts tab, set one account as Master and others as Receivers'
    },
    {
      step: 2,
      icon: Download,
      title: 'Download EAs',
      description: 'Download the appropriate EA for each account role from the Export tab'
    },
    {
      step: 3,
      icon: FolderOpen,
      title: 'Install EAs',
      description: 'Place EA files in your MT5\'s MQL5/Experts folder, then compile with F7'
    },
    {
      step: 4,
      icon: FileCode,
      title: 'Download Config',
      description: 'Generate and download the config file, place in MQL5/Files on all terminals'
    },
    {
      step: 5,
      icon: Play,
      title: 'Attach & Configure',
      description: 'Attach appropriate EA to any chart, enter your API key for journaling'
    },
    {
      step: 6,
      icon: CheckCircle2,
      title: 'Verify',
      description: 'Check the Activity tab to confirm trades are being copied and journaled'
    }
  ];

  const faqs = [
    {
      id: 'transition',
      question: 'How do I switch from TradeJournalBridge to TradeCopierMaster?',
      answer: 'Simply remove TradeJournalBridge from your chart and attach TradeCopierMaster instead. Use the SAME API key you were using before - this ensures all trades (past and future) stay linked to the same account. The idempotency system prevents any duplicates.'
    },
    {
      id: 'bridge',
      question: 'Do I need TradeJournalBridge if I\'m copying trades?',
      answer: 'No! Both TradeCopierMaster.mq5 and TradeCopierReceiver.mq5 have journaling built-in. Use TradeJournalBridge.mq5 only for Independent accounts that don\'t participate in copying.'
    },
    {
      id: 'api-key',
      question: 'Where do I get my API key?',
      answer: 'Go to the Accounts page and you\'ll find your API key in your account settings. Each account has its own unique API key for journaling. You can also see it in the Accounts tab here when you set a role.'
    },
    {
      id: 'same-key',
      question: 'Should I use the same API key across different EAs?',
      answer: 'Yes! Always use the same API key for the same trading account. This keeps all your trades linked together and prevents duplicate accounts from being created.'
    },
    {
      id: 'config-path',
      question: 'Where should I place the config file?',
      answer: 'Place copier-config.json in the MQL5/Files folder on each MT5 terminal. Both Master and Receiver EAs need access to this file.'
    },
    {
      id: 'multiple-receivers',
      question: 'Can I have multiple receiver accounts?',
      answer: 'Yes! You can have as many receiver accounts as you want. Each will execute trades independently with their own risk settings.'
    },
    {
      id: 'latency',
      question: 'What\'s the copy latency?',
      answer: 'Using the local file queue, latency is typically 100-500ms depending on your poll interval setting. The desktop app can achieve 20-50ms latency.'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Architecture Diagram */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            How Trade Copying Works
          </CardTitle>
          <CardDescription>
            Visual overview of the EA architecture and data flow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-6 bg-muted/30 rounded-lg">
            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8">
              {/* Master */}
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-2">
                  <Crown className="h-8 w-8 text-primary" />
                </div>
                <p className="font-medium">Master Account</p>
                <p className="text-xs text-muted-foreground">TradeCopierMaster.mq5</p>
                <div className="mt-2 flex flex-col gap-1">
                  <Badge variant="outline" className="text-xs">Trades Here</Badge>
                  <Badge variant="outline" className="text-xs">Journals to Cloud</Badge>
                </div>
              </div>

              {/* Arrows */}
              <div className="flex flex-col items-center gap-2">
                <div className="text-xs text-muted-foreground text-center">
                  Local File Queue
                </div>
                <ArrowRight className="h-6 w-6 text-muted-foreground hidden md:block" />
                <div className="h-6 w-px bg-muted-foreground md:hidden" />
              </div>

              {/* Receivers */}
              <div className="flex flex-col gap-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Radio className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Receiver {i}</p>
                      <p className="text-xs text-muted-foreground">Executes + Journals</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cloud connection */}
            <div className="mt-6 pt-4 border-t border-dashed flex items-center justify-center gap-4">
              <div className="text-center">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mx-auto mb-1">
                  <BookOpen className="h-5 w-5 text-blue-500" />
                </div>
                <p className="text-xs text-muted-foreground">Cloud Journal</p>
              </div>
              <p className="text-xs text-muted-foreground">
                All EAs journal trades independently
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* EA Roles */}
      <Card>
        <CardHeader>
          <CardTitle>Which EA to Use</CardTitle>
          <CardDescription>
            Each account role requires a specific EA
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {eaRoles.map(({ role, ea, icon: Icon, color, bgColor, features }) => (
              <div key={role} className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-full ${bgColor} flex items-center justify-center`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <div>
                    <p className="font-medium">{role}</p>
                    <p className="text-xs text-muted-foreground font-mono">{ea}</p>
                  </div>
                </div>
                <ul className="space-y-1">
                  {features.map((feature, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-1 flex-shrink-0 text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Setup Steps */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Setup Guide</CardTitle>
          <CardDescription>
            Get trade copying running in 6 steps
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {setupSteps.map(({ step, icon: Icon, title, description }) => (
              <div key={step} className="p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Step {step}
                      </span>
                    </div>
                    <h4 className="font-medium text-sm">{title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Frequently Asked Questions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {faqs.map(({ id, question, answer }) => (
            <Collapsible
              key={id}
              open={faqOpen === id}
              onOpenChange={(open) => setFaqOpen(open ? id : null)}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted/50 transition-colors text-left">
                <span className="font-medium text-sm">{question}</span>
                {faqOpen === id ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3">
                <p className="text-sm text-muted-foreground">{answer}</p>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </CardContent>
      </Card>

      {/* Transition Guide */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <ArrowRight className="h-5 w-5" />
            Transitioning from Journal-Only?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            If you're already using <code className="bg-muted px-1 rounded">TradeJournalBridge.mq5</code> and want to enable trade copying:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Copy your existing <strong>API key</strong> from the Accounts page</li>
            <li>Remove TradeJournalBridge from your chart</li>
            <li>Attach <code className="bg-muted px-1 rounded">TradeCopierMaster.mq5</code> with the <strong>same API key</strong></li>
            <li>On receiver accounts, use <code className="bg-muted px-1 rounded">TradeCopierReceiver.mq5</code> with their respective API keys</li>
          </ol>
          <Alert className="bg-green-500/10 border-green-500/30">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-sm">
              Using the same API key ensures all trades (past and future) stay linked to the same account. The system automatically prevents duplicates.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Help Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Need more help? Check the full documentation or visit the Activity tab to verify your setup is working correctly.
        </AlertDescription>
      </Alert>
    </div>
  );
}
